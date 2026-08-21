import * as Vitest from "@effect/vitest"
import type { Done } from "effect/Cause"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Arr from "effect/Array"
import * as TestConsole from "effect/testing/TestConsole"
import { encodeExchangeLine, encodeJsonLine, type RecordedExchange, referenceFixturePath } from "./fixture.ts"
import {
	HarnessLive,
	loadFixture,
	parseReplayArgs,
	replayTraffic,
	requestLineFromExchange,
	resolveReplayConfig,
	runReplayHarness,
} from "./replay.ts"

const Platform = HarnessLive

const json = (value: Schema.Json): Schema.Json => value

const ECHO_SIDECAR = `const decoder = new TextDecoder()
const fixturePath = Bun.argv[2]
const body = await Bun.file(fixturePath).text()
const exchanges = []
for (const line of body.split("\\n")) {
  if (line.trim().length === 0) {
    continue
  }
  exchanges.push(JSON.parse(line))
}
const byId = {}
for (const exchange of exchanges) {
  byId[String(exchange.response.id)] = exchange
}
function reverseKeys(value) {
  if (Array.isArray(value)) {
    return value.map(reverseKeys)
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).reverse()
    const out = {}
    for (const key of keys) {
      out[key] = reverseKeys(value[key])
    }
    return out
  }
  return value
}
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
    const exchange = byId[String(parsed.id)]
    if (!exchange) {
      continue
    }
    for (const notification of exchange.notifications) {
      await Bun.write(Bun.stdout, JSON.stringify(reverseKeys(notification)) + "\\n")
    }
    await Bun.write(Bun.stdout, JSON.stringify(reverseKeys(exchange.response)) + "\\n")
  }
}
`

const WRONG_SIDECAR = `const decoder = new TextDecoder()
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
    await Bun.write(Bun.stdout, JSON.stringify({
      jsonrpc: "2.0",
      id: parsed.id,
      result: { ok: false, unexpected: true }
    }) + "\\n")
  }
}
`

const sampleExchange: RecordedExchange = {
	recordedAt: "2026-08-17T08:55:01.034Z",
	command: "acp_new_session",
	payload: json({ cwd: "/tmp", agent_id: "claude" }),
	response: json({ jsonrpc: "2.0", id: 2, result: { session_id: "81fde13c-1b27-4552-8b90-25b04c88aa50" } }),
	notifications: Arr.empty(),
}

Vitest.describe("parseReplayArgs", () => {
	Vitest.it("reads fixture, --against, --skip, and args after --", () => {
		const parsed = parseReplayArgs([
			"replay",
			"fixtures/claude-session-reference.ndjson",
			"--against",
			"bun",
			"--skip",
			"acp_send_prompt, acp_initialize",
			"--",
			"echo.js",
		])
		Vitest.assert.strictEqual(parsed.fixture, "fixtures/claude-session-reference.ndjson")
		Vitest.assert.strictEqual(parsed.against, "bun")
		Vitest.assert.deepStrictEqual(parsed.implArgs, ["echo.js"])
		Vitest.assert.deepStrictEqual(parsed.skipCommands, ["acp_send_prompt", "acp_initialize"])
	})
})

const missingLayer = Layer.mergeAll(
	Stdio.layerTest({
		args: Effect.succeed(Arr.of("replay")),
	}),
	ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
)

Vitest.layer(missingLayer)("resolveReplayConfig", (it) => {
	it.effect("fails when fixture and implementation are missing", () =>
		Effect.gen(function* () {
			const error = yield* resolveReplayConfig().pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "MissingFixture")
		}),
	)
})

Vitest.describe("requestLineFromExchange", () => {
	Vitest.it.effect("rebuilds the recorded jsonrpc request", () =>
		Effect.gen(function* () {
			const line = yield* requestLineFromExchange(sampleExchange)
			Vitest.assert.isTrue(Option.isSome(line))
			if (Option.isSome(line)) {
				Vitest.assert.isTrue(line.value.includes("acp_new_session"))
				Vitest.assert.isTrue(line.value.includes("\"id\":2"))
			}
		}),
	)
})

Vitest.describe("replayTraffic", () => {
	Vitest.it.effect("feeds recorded requests and grades the impl output", () =>
		Effect.gen(function* () {
			const toImpl = yield* Queue.unbounded<string, Done>()
			const fromImpl = yield* Queue.unbounded<string, Done>()
			const prompt = yield* encodeJsonLine({
				jsonrpc: "2.0",
				id: 2,
				method: "acp_new_session",
				params: sampleExchange.payload,
			})
			yield* Effect.forkChild(
				Effect.gen(function* () {
					const incoming = yield* Queue.take(toImpl)
					Vitest.assert.strictEqual(incoming, prompt)
					const response = yield* encodeJsonLine({
						result: { session_id: "66affa11-28c2-4bc6-bd47-ceb539aacda7" },
						id: 2,
						jsonrpc: "2.0",
					})
					yield* Queue.offer(fromImpl, response)
					yield* Queue.end(fromImpl)
				}),
			)
			const grades = yield* replayTraffic({
				exchanges: Arr.of(sampleExchange),
				implLines: Stream.fromQueue(fromImpl),
				writeToImpl: (line) => Queue.offer(toImpl, line).pipe(Effect.asVoid),
				onFinished: Effect.void,
				skipCommands: Arr.empty(),
				responseTimeout: Duration.seconds(5),
			})
			Vitest.assert.strictEqual(grades.length, 1)
			const grade = Arr.head(grades)
			Vitest.assert.isTrue(Option.isSome(grade))
			if (Option.isSome(grade)) {
				Vitest.assert.strictEqual(grade.value.status, "pass")
			}
		}),
	)
})

Vitest.layer(Platform)("runReplayHarness", (it) => {
	it.effect("replays the recorded sidecar fixture against a shuffled echo of itself at 100 percent", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "echo-sidecar.js")
			const fixturePath = yield* referenceFixturePath()
			yield* fs.writeFileString(scriptPath, ECHO_SIDECAR)
			const exchanges = yield* loadFixture(fixturePath)
			Vitest.assert.isTrue(exchanges.length > 0)
			const report = yield* runReplayHarness().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					Layer.mergeAll(
						Stdio.layerTest({
							args: Effect.succeed([
								"replay",
								fixturePath,
								"--against",
								"bun",
								"--",
								scriptPath,
								fixturePath,
							]),
							stdout: () => Sink.drain,
						}),
						ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
					),
				),
			)
			Vitest.assert.strictEqual(report.fail, 0)
			Vitest.assert.strictEqual(report.skipped, 0)
			Vitest.assert.strictEqual(report.pass, exchanges.length)
		}),
	)

	it.effect("exits through GradeFailed and prints the first divergence path", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const scriptPath = path.join(dir, "wrong-sidecar.js")
			const fixturePath = path.join(dir, "one.ndjson")
			yield* fs.writeFileString(scriptPath, WRONG_SIDECAR)
			const line = yield* encodeExchangeLine(sampleExchange)
			yield* fs.writeFileString(fixturePath, `${line}\n`)
			const error = yield* runReplayHarness().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(
					Layer.mergeAll(
						Stdio.layerTest({
							args: Effect.succeed(["replay", fixturePath, "--against", "bun", "--", scriptPath]),
							stdout: () => Sink.drain,
						}),
						ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
					),
				),
				Effect.flip,
			)
			Vitest.assert.strictEqual(error._tag, "GradeFailed")
			if (error._tag === "GradeFailed") {
				Vitest.assert.isTrue(error.path.includes("exchanges[0].response"))
			}
			const logs = yield* TestConsole.logLines
			const printed = Arr.join(Arr.filter(logs, Predicate.isString), "\n")
			Vitest.assert.isTrue(printed.includes("first divergence:"))
			Vitest.assert.isTrue(printed.includes("fail: 1"))
		}),
	)
})
