import { SessionId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	OpenTerminalInput,
	TerminalCwdNotDirectoryError,
	TerminalCwdNotFoundError,
	TerminalId,
	TerminalNotRunningError,
	TerminalOpenError,
	TerminalSessionLookupError
} from "./TerminalService.ts"

const sessionId = SessionId.make("session-1")

Vitest.describe("OpenTerminalInput", () => {
	Vitest.it.effect("decodes an interactive open request", () =>
		Effect.gen(function*() {
			const decoded = yield* Schema.decodeUnknownEffect(OpenTerminalInput)({
				sessionId,
				cwd: "/tmp/project"
			})
			Vitest.assert.strictEqual(decoded.sessionId, sessionId)
			Vitest.assert.strictEqual(decoded.cwd, "/tmp/project")
			Vitest.assert.strictEqual(decoded.command, undefined)
		})
	)

	Vitest.it.effect("decodes a command terminal with env and output limit", () =>
		Effect.gen(function*() {
			const decoded = yield* Schema.decodeUnknownEffect(OpenTerminalInput)({
				sessionId,
				cwd: "/tmp/project",
				command: "echo hello",
				cols: 120,
				rows: 30,
				outputByteLimit: 32000,
				env: [{ name: "FOO", value: "bar" }]
			})
			Vitest.assert.strictEqual(decoded.command, "echo hello")
			Vitest.assert.strictEqual(decoded.cols, 120)
			Vitest.assert.strictEqual(decoded.outputByteLimit, 32000)
			Vitest.assert.deepStrictEqual(decoded.env, [{ name: "FOO", value: "bar" }])
		})
	)
})

Vitest.describe("terminal errors", () => {
	Vitest.it.effect("are tagged yieldable errors", () =>
		Effect.gen(function*() {
			const missing = yield* Effect.flip(new TerminalCwdNotFoundError({ cwd: "/nope" }))
			Vitest.assert.strictEqual(missing._tag, "TerminalCwdNotFoundError")
			Vitest.assert.isTrue(Schema.is(TerminalCwdNotFoundError)(missing))
			const notDir = yield* Effect.flip(new TerminalCwdNotDirectoryError({ cwd: "/tmp/file" }))
			Vitest.assert.strictEqual(notDir.message, "Terminal cwd is not a directory: /tmp/file")
			const lookup = yield* Effect.flip(
				new TerminalSessionLookupError({ terminalId: TerminalId.make("term-1") })
			)
			Vitest.assert.strictEqual(lookup.message, "Unknown terminal: term-1")
			const stopped = yield* Effect.flip(
				new TerminalNotRunningError({ terminalId: TerminalId.make("term-1") })
			)
			Vitest.assert.strictEqual(stopped._tag, "TerminalNotRunningError")
			const open = yield* Effect.flip(new TerminalOpenError({ detail: "uuid failed" }))
			Vitest.assert.strictEqual(open.message, "Failed to open terminal: uuid failed")
		})
	)
})
