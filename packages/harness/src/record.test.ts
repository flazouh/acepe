import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { encodeJsonLine, type RecordedExchange } from "./fixture.ts"
import { HarnessLive, parseRecordArgs, recordTraffic, resolveRecordConfig, runRecordHarness } from "./record.ts"
import { REDACTED_SECRET } from "./redact.ts"

const Platform = HarnessLive

const requestLine = Effect.fn("requestLine")((id: number, method: string, payload: Schema.Json) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		id,
		method,
		params: payload,
	}),
)

const successLine = Effect.fn("successLine")((id: number, result: Schema.Json) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		id,
		result,
	}),
)

const notificationLine = Effect.fn("notificationLine")((method: string, payload: Schema.Json, seq: number) =>
	encodeJsonLine({
		jsonrpc: "2.0",
		method,
		params: {
			sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
			seq,
			payload,
		},
	}),
)

const FAKE_SIDECAR = `const decoder = new TextDecoder()
let buffer = ""
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk)
  for (;;) {
    const idx = buffer.indexOf("\\n")
    if (idx === -1) {
      break
    }
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 1)
    if (line.trim().length === 0) {
      continue
    }
    const parsed = JSON.parse(line)
    if (parsed.id === undefined) {
      continue
    }
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "acp-session-update",
      params: {
        sessionId: "81fde13c-1b27-4552-8b90-25b04c88aa50",
        seq: 1,
        payload: { type: "agentMessageChunk", text: "forwarded" }
      }
    })
    const success = JSON.stringify({
      jsonrpc: "2.0",
      id: parsed.id,
      result: { ok: true }
    })
    await Bun.write(Bun.stdout, notification + "\\n" + success + "\\n")
  }
}
`

const setRecordedAt = Effect.fn("setRecordedAt")(function* () {
	const recordedAt = DateTime.make("2026-08-21T00:08:00.000Z")
	Vitest.assert.isTrue(Option.isSome(recordedAt))
	if (Option.isSome(recordedAt)) {
		yield* TestClock.setTime(recordedAt.value.pipe(DateTime.toEpochMillis))
	}
})

Vitest.describe("parseRecordArgs", () => {
	Vitest.it("reads --sidecar, --out, and args after --", () => {
		const parsed = parseRecordArgs(["--out", "tmp/out", "--sidecar", "bun", "--", "fake-sidecar.js"])
		Vitest.assert.strictEqual(parsed.sidecarBin, "bun")
		Vitest.assert.strictEqual(parsed.outDir, "tmp/out")
		Vitest.assert.deepStrictEqual(parsed.sidecarArgs, ["fake-sidecar.js"])
	})
})

const missingSidecarLayer = Layer.mergeAll(
	Stdio.layerTest({
		args: Effect.succeed(Arr.empty<string>()),
	}),
	ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
)

Vitest.layer(missingSidecarLayer)("resolveRecordConfig", (it) => {
	it.effect("fails when no sidecar binary is given", () =>
		Effect.gen(function* () {
			const error = yield* resolveRecordConfig().pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "MissingSidecarBin")
		}),
	)
})

const sidecarFromEnvLayer = Layer.mergeAll(
	Stdio.layerTest({
		args: Effect.succeed(Arr.empty<string>()),
	}),
	ConfigProvider.layer(
		ConfigProvider.fromEnv({
			env: {
				ACEPE_SIDECAR_BIN: "/usr/bin/acepe-sidecar",
				ACEPE_HARNESS_OUT: "/tmp/harness-out",
			},
		}),
	),
)

Vitest.layer(sidecarFromEnvLayer)("resolveRecordConfig env", (it) => {
	it.effect("reads ACEPE_SIDECAR_BIN and ACEPE_HARNESS_OUT", () =>
		Effect.gen(function* () {
			const config = yield* resolveRecordConfig()
			Vitest.assert.strictEqual(config.sidecarBin, "/usr/bin/acepe-sidecar")
			Vitest.assert.strictEqual(config.outDir, "/tmp/harness-out")
		}),
	)
})

Vitest.describe("recordTraffic", () => {
	Vitest.it.effect("forwards lines and records a redacted exchange", () =>
		Effect.gen(function* () {
			yield* setRecordedAt()
			const toSidecar = yield* Queue.unbounded<string, Done>()
			const fromSidecar = yield* Queue.unbounded<string, Done>()
			const toApp = yield* Ref.make(Arr.empty<string>())
			const fixtures = yield* Ref.make(Arr.empty<RecordedExchange>())
			const prompt = yield* requestLine(3, "acp_send_prompt", {
				session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50",
				request: { text: "How many PRs do we have in the stack?" },
				apiKey: "sk-live-secret",
			})
			const notification = yield* notificationLine(
				"acp-session-update",
				{ type: "permissionRequest", permissionRequest: { id: "perm-1" } },
				1,
			)
			const success = yield* successLine(3, { ok: true })
			yield* Effect.forkChild(
				Effect.gen(function* () {
					const incoming = yield* Queue.take(toSidecar)
					Vitest.assert.strictEqual(incoming, prompt)
					yield* Queue.offer(fromSidecar, notification)
					yield* Queue.offer(fromSidecar, success)
					yield* Queue.end(fromSidecar)
				}),
			)
			yield* recordTraffic({
				appLines: Stream.make("", prompt),
				sidecarLines: Stream.fromQueue(fromSidecar),
				writeToApp: (line) => Ref.update(toApp, (lines) => Arr.append(lines, line)).pipe(Effect.asVoid),
				writeToSidecar: (line) => Queue.offer(toSidecar, line).pipe(Effect.asVoid),
				writeExchange: (exchange) =>
					Ref.update(fixtures, (rows) => Arr.append(rows, exchange)).pipe(Effect.asVoid),
				onAppEnded: Effect.void,
			})
			const forwarded = yield* Ref.get(toApp)
			Vitest.assert.deepStrictEqual(forwarded, [notification, success])
			const recorded = yield* Ref.get(fixtures)
			Vitest.assert.strictEqual(recorded.length, 1)
			const exchange = Arr.head(recorded)
			Vitest.assert.isTrue(Option.isSome(exchange))
			if (Option.isSome(exchange)) {
				Vitest.assert.strictEqual(exchange.value.recordedAt, "2026-08-21T00:08:00.000Z")
				Vitest.assert.strictEqual(exchange.value.command, "acp_send_prompt")
				Vitest.assert.deepStrictEqual(exchange.value.payload, {
					session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50",
					request: { text: "How many PRs do we have in the stack?" },
					apiKey: REDACTED_SECRET,
				})
				Vitest.assert.strictEqual(exchange.value.notifications.length, 1)
			}
		}),
	)
})

Vitest.layer(Platform)("runRecordHarness", (it) => {
	it.effect("wraps a sidecar process and writes a timestamped NDJSON fixture", () =>
		Effect.gen(function* () {
			yield* setRecordedAt()
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "fake-sidecar.js")
			const outDir = path.join(dir, "out")
			yield* fs.writeFileString(scriptPath, FAKE_SIDECAR)
			const prompt = yield* requestLine(1, "acp_send_prompt", {
				session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50",
				request: { text: "How many PRs do we have in the stack?" },
			})
			const stdout = yield* Ref.make("")
			const fixturePath = yield* runRecordHarness().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					Layer.mergeAll(
						Stdio.layerTest({
							args: Effect.succeed(["--sidecar", "bun", "--out", outDir, "--", scriptPath]),
							stdin: Stream.encodeText(Stream.make(`${prompt}\n`)),
							stdout: () =>
								Sink.forEach((chunk) =>
									Ref.update(stdout, (current) => current + (Predicate.isString(chunk) ? chunk : "")).pipe(
										Effect.asVoid,
									),
								),
						}),
						ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
					),
				),
			)
			Vitest.assert.strictEqual(path.basename(fixturePath), "2026-08-21T00-08-00.000Z.ndjson")
			const body = yield* fs.readFileString(fixturePath)
			Vitest.assert.isTrue(body.includes("acp_send_prompt"))
			Vitest.assert.isTrue(body.includes("agentMessageChunk"))
			const forwarded = yield* Ref.get(stdout)
			Vitest.assert.isTrue(forwarded.includes("forwarded"))
			Vitest.assert.isTrue(forwarded.includes("\"ok\":true"))
		}),
	)
})
