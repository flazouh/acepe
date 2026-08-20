import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
	decodeExchangeLine,
	decodeJsonLine,
	encodeExchangeLine,
	fixtureFileName,
	RecordedExchange,
	REFERENCE_FIXTURE_FILE_NAME,
	referenceFixturePath,
} from "./fixture.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const sampleExchange = {
	recordedAt: "2026-08-17T14:01:38.562Z",
	command: "acp_send_prompt",
	payload: { session_id: "session-1", request: { text: "hello" } },
	response: { jsonrpc: "2.0", id: 3, result: null },
	notifications: [
		{
			jsonrpc: "2.0",
			method: "acp-session-update",
			params: { sessionId: "session-1", seq: 1, payload: { type: "agentMessageChunk" } },
		},
	],
}

Vitest.describe("RecordedExchange", () => {
	Vitest.it.effect("round-trips an NDJSON fixture line", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(RecordedExchange)(sampleExchange)
			const line = yield* encodeExchangeLine(decoded)
			Vitest.assert.isFalse(line.includes("\n"))
			const roundTrip = yield* decodeExchangeLine(line)
			Vitest.assert.deepStrictEqual(roundTrip, decoded)
		}),
	)

	Vitest.it.effect("rejects a line that is missing the command name", () =>
		Effect.gen(function* () {
			const line = yield* decodeJsonLine(
				'{"recordedAt":"2026-08-17T14:01:38.562Z","payload":{},"response":{},"notifications":[]}',
			)
			const encoded = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))(line)
			const exit = yield* Effect.exit(decodeExchangeLine(encoded))
			Vitest.assert.isTrue(Exit.isFailure(exit))
		}),
	)
})

Vitest.describe("fixtureFileName", () => {
	Vitest.it("uses the ISO timestamp with colons replaced", () => {
		const recordedAt = DateTime.make("2026-08-21T00:08:00.000Z")
		Vitest.assert.isTrue(Option.isSome(recordedAt))
		if (Option.isSome(recordedAt)) {
			Vitest.assert.strictEqual(fixtureFileName(recordedAt.value), "2026-08-21T00-08-00.000Z.ndjson")
		}
	})
})

Vitest.layer(Platform)("reference fixture", (it) => {
	it.effect("records a real Claude session with tool calls, a permission prompt, and a compaction", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const fixturePath = yield* referenceFixturePath()
			Vitest.assert.isTrue(fixturePath.endsWith(REFERENCE_FIXTURE_FILE_NAME))
			const body = yield* fs.readFileString(fixturePath)
			const lines = yield* Stream.make(body).pipe(Stream.splitLines, Stream.runCollect)
			const exchanges = yield* Effect.forEach(lines, decodeExchangeLine)
			Vitest.assert.isTrue(exchanges.length > 0)

			const commands = Arr.map(exchanges, (exchange) => exchange.command)
			Vitest.assert.isTrue(commands.includes("acp_send_prompt"))
			Vitest.assert.isTrue(commands.includes("acp_respond_inbound_request"))

			const encoded = yield* Effect.forEach(exchanges, encodeExchangeLine)
			const joined = Arr.join(encoded, "\n")
			Vitest.assert.isTrue(joined.includes("toolCallId"))
			Vitest.assert.isTrue(joined.includes("permissionRequest"))
			Vitest.assert.isTrue(joined.includes("compactionEvent"))
			Vitest.assert.isFalse(joined.includes("sk-live-secret"))
		}),
	)
})
