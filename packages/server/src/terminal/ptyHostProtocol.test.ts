import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
	decodePtyHostCommand,
	decodePtyHostEvent,
	encodePtyHostCommand,
	encodePtyHostEvent,
	PtyHostCommand,
	PtyHostEvent
} from "./ptyHostProtocol.ts"

Vitest.describe("ptyHostProtocol", () => {
	Vitest.it.effect("round-trips a spawn command and a data event", () =>
		Effect.gen(function*() {
			const spawnLine = yield* encodePtyHostCommand({
				op: "spawn",
				shell: "/bin/sh",
				args: ["-c", "echo hello"],
				cwd: "/tmp",
				cols: 80,
				rows: 24,
				env: { PATH: "/bin", TERM: "xterm-256color" }
			})
			const spawn = yield* decodePtyHostCommand(spawnLine)
			Vitest.assert.strictEqual(spawn.op, "spawn")
			if (spawn.op === "spawn") {
				Vitest.assert.strictEqual(spawn.shell, "/bin/sh")
				Vitest.assert.deepStrictEqual(spawn.args, ["-c", "echo hello"])
				Vitest.assert.strictEqual(spawn.env["PATH"], "/bin")
			}
			Vitest.assert.isTrue(Schema.is(PtyHostCommand)(spawn))
			const eventLine = yield* encodePtyHostEvent({ op: "data", data: "hello_world\r\n" })
			const event = yield* decodePtyHostEvent(eventLine)
			Vitest.assert.strictEqual(event.op, "data")
			if (event.op === "data") {
				Vitest.assert.strictEqual(event.data, "hello_world\r\n")
			}
			Vitest.assert.isTrue(Schema.is(PtyHostEvent)(event))
		})
	)

	Vitest.it.effect("decodes ready, exit, and error events", () =>
		Effect.gen(function*() {
			const readyLine = yield* encodePtyHostEvent({ op: "ready", pid: 12 })
			const ready = yield* decodePtyHostEvent(readyLine)
			Vitest.assert.strictEqual(ready.op, "ready")
			const exitLine = yield* encodePtyHostEvent({ op: "exit", exitCode: 0, signal: null })
			const exit = yield* decodePtyHostEvent(exitLine)
			Vitest.assert.strictEqual(exit.op, "exit")
			const errorLine = yield* encodePtyHostEvent({
				op: "error",
				detail: "posix_spawnp failed."
			})
			const error = yield* decodePtyHostEvent(errorLine)
			Vitest.assert.strictEqual(error.op, "error")
			if (error.op === "error") {
				Vitest.assert.strictEqual(error.detail, "posix_spawnp failed.")
			}
		})
	)
})
