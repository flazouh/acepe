import { CommandId, SessionId, TerminalId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { fillTerminalCommand } from "./fillCommand.ts"
import { TerminalRegistryLive } from "./Layers/TerminalRegistry.ts"
import {
	decodeTerminalId as decodeServerTerminalId,
	TerminalCwdNotFoundError,
	TerminalService,
	type TerminalHandle,
	type TerminalOutput
} from "./Services/TerminalService.ts"

const sessionId = SessionId.make("session-1")
const terminalId = TerminalId.make("term-1")
const commandId = CommandId.make("cmd-1")

const makeFakeTerminalService = () => {
	const writes: Array<string> = []
	const resizes: Array<{ cols: number; rows: number }> = []
	let killed = false
	let released = false
	let outputText = ""
	let exited = false
	const serverTerminalId = Effect.runSync(decodeServerTerminalId("pty-1"))

	const service = TerminalService.of({
		open: () =>
			Effect.succeed({
				terminalId: serverTerminalId,
				sessionId,
				pid: 4242,
				shell: "/bin/sh"
			} satisfies TerminalHandle),
		write: (_id, data) =>
			Effect.sync(() => {
				writes.push(data)
				outputText = `${outputText}${data}`
			}),
		resize: (_id, cols, rows) =>
			Effect.sync(() => {
				resizes.push({ cols, rows })
			}),
		signal: () => Effect.void,
		output: () =>
			Effect.succeed({
				output: outputText,
				truncated: false,
				exitStatus: exited ? { exitCode: 0, signal: null } : null
			} satisfies TerminalOutput),
		waitForExit: () => Effect.succeed({ exitCode: 0, signal: null }),
		kill: () =>
			Effect.sync(() => {
				killed = true
				exited = true
			}),
		release: () =>
			Effect.sync(() => {
				released = true
			}),
		releaseSession: () => Effect.void
	})

	return {
		layer: Layer.succeed(TerminalService, service),
		writes,
		resizes,
		isKilled: () => killed,
		isReleased: () => released
	}
}

const fake = makeFakeTerminalService()
const TestLive = Layer.mergeAll(fake.layer, TerminalRegistryLive)

Vitest.layer(TestLive)("fillTerminalCommand", (it) => {
	it.effect("fills terminal.open with the spawned handle's output snapshot", () =>
		Effect.gen(function*() {
			const filled = yield* fillTerminalCommand({
				type: "terminal.open",
				commandId,
				terminalId,
				sessionId,
				cwd: "/tmp"
			})
			Vitest.assert.strictEqual(filled.type, "terminal.open")
			if (filled.type !== "terminal.open") {
				return
			}
			Vitest.assert.strictEqual(filled.cols, 80)
			Vitest.assert.strictEqual(filled.rows, 24)
			Vitest.assert.strictEqual(filled.output, "")
			Vitest.assert.strictEqual(filled.closed, false)
		})
	)

	it.effect("fills terminal.input by writing to the registered terminal and returning cumulative output", () =>
		Effect.gen(function*() {
			const filled = yield* fillTerminalCommand({
				type: "terminal.input",
				commandId,
				terminalId,
				data: "echo hi\n"
			})
			Vitest.assert.strictEqual(filled.type, "terminal.input")
			if (filled.type !== "terminal.input") {
				return
			}
			Vitest.assert.strictEqual(filled.output, "echo hi\n")
			Vitest.assert.deepStrictEqual(fake.writes, ["echo hi\n"])
			Vitest.assert.strictEqual(filled.sessionId, sessionId)
			Vitest.assert.strictEqual(filled.cwd, "/tmp")
		})
	)

	it.effect("fills terminal.resize and remembers the new size", () =>
		Effect.gen(function*() {
			const filled = yield* fillTerminalCommand({
				type: "terminal.resize",
				commandId,
				terminalId,
				cols: 120,
				rows: 40
			})
			Vitest.assert.strictEqual(filled.type, "terminal.resize")
			if (filled.type !== "terminal.resize") {
				return
			}
			Vitest.assert.strictEqual(filled.sessionId, sessionId)
			Vitest.assert.deepStrictEqual(fake.resizes, [{ cols: 120, rows: 40 }])
		})
	)

	it.effect("fills terminal.close, kills and releases the terminal, marks closed", () =>
		Effect.gen(function*() {
			const filled = yield* fillTerminalCommand({
				type: "terminal.close",
				commandId,
				terminalId
			})
			Vitest.assert.strictEqual(filled.type, "terminal.close")
			if (filled.type !== "terminal.close") {
				return
			}
			Vitest.assert.strictEqual(filled.closed, true)
			Vitest.assert.strictEqual(fake.isKilled(), true)
			Vitest.assert.strictEqual(fake.isReleased(), true)
		})
	)

	it.effect("passes non-terminal commands through unchanged", () =>
		Effect.gen(function*() {
			const command = {
				type: "project.create" as const,
				commandId,
				projectId: sessionId as unknown as never,
				title: "x" as never,
				workspaceRoot: "/tmp" as never
			}
			const filled = yield* fillTerminalCommand(command)
			Vitest.assert.strictEqual(filled, command)
		})
	)
})

const unregisteredFake = makeFakeTerminalService()
const UnregisteredLive = Layer.mergeAll(unregisteredFake.layer, TerminalRegistryLive)

Vitest.layer(UnregisteredLive)("fillTerminalCommand against an unregistered terminal", (it) => {
	it.effect("fails terminal.input for a terminal that was never opened", () =>
		Effect.gen(function*() {
			const error = yield* fillTerminalCommand({
				type: "terminal.input",
				commandId,
				terminalId,
				data: "x"
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
		})
	)
})

const FailingLive = Layer.mergeAll(
	Layer.succeed(
		TerminalService,
		TerminalService.of({
			open: () => Effect.fail(new TerminalCwdNotFoundError({ cwd: "/nope" })),
			write: () => Effect.void,
			resize: () => Effect.void,
			signal: () => Effect.void,
			output: () =>
				Effect.succeed({ output: "", truncated: false, exitStatus: null } satisfies TerminalOutput),
			waitForExit: () => Effect.succeed({ exitCode: 0, signal: null }),
			kill: () => Effect.void,
			release: () => Effect.void,
			releaseSession: () => Effect.void
		})
	),
	TerminalRegistryLive
)

Vitest.layer(FailingLive)("fillTerminalCommand surfaces TerminalService failures", (it) => {
	it.effect("maps a TerminalService failure into OrchestrationCommandInvariantError", () =>
		Effect.gen(function*() {
			const error = yield* fillTerminalCommand({
				type: "terminal.open",
				commandId,
				terminalId,
				sessionId,
				cwd: "/nope"
			}).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "OrchestrationCommandInvariantError")
		})
	)
})
