import {
	capTerminalOutput,
	DEFAULT_TERMINAL_COLS,
	DEFAULT_TERMINAL_ROWS,
	type OrchestrationCommand
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { TerminalRegistry } from "./Services/TerminalRegistry.ts"
import { TerminalService, type TerminalError } from "./Services/TerminalService.ts"
import type { TerminalRegistryLookupError } from "./Services/TerminalRegistry.ts"

const asTerminalInvariant = (commandType: string) => (error: TerminalError | TerminalRegistryLookupError) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const fillOpen = Effect.fn("fillTerminalOpen")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.open" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const cols = command.cols ?? DEFAULT_TERMINAL_COLS
	const rows = command.rows ?? DEFAULT_TERMINAL_ROWS
	const handle = yield* terminalService
		.open({
			sessionId: command.sessionId,
			cwd: command.cwd,
			cols,
			rows
		})
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* registry.register(command.terminalId, {
		serverTerminalId: handle.terminalId,
		sessionId: command.sessionId,
		cwd: command.cwd,
		cols,
		rows
	})
	const output = yield* terminalService
		.output(handle.terminalId)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		sessionId: command.sessionId,
		cwd: command.cwd,
		cols,
		rows,
		output: capTerminalOutput(output.output),
		closed: output.exitStatus !== null
	} satisfies OrchestrationCommand
})

const fillInput = Effect.fn("fillTerminalInput")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.input" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* registry.require(command.terminalId).pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* terminalService
		.write(entry.serverTerminalId, command.data)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	const output = yield* terminalService
		.output(entry.serverTerminalId)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		data: command.data,
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		cols: entry.cols,
		rows: entry.rows,
		output: capTerminalOutput(output.output),
		closed: output.exitStatus !== null
	} satisfies OrchestrationCommand
})

const fillResize = Effect.fn("fillTerminalResize")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.resize" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* registry.require(command.terminalId).pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* terminalService
		.resize(entry.serverTerminalId, command.cols, command.rows)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* registry.updateSize(command.terminalId, command.cols, command.rows).pipe(
		Effect.mapError(asTerminalInvariant(command.type))
	)
	const output = yield* terminalService
		.output(entry.serverTerminalId)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		cols: command.cols,
		rows: command.rows,
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		output: capTerminalOutput(output.output),
		closed: output.exitStatus !== null
	} satisfies OrchestrationCommand
})

const fillClose = Effect.fn("fillTerminalClose")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.close" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* registry.require(command.terminalId).pipe(Effect.mapError(asTerminalInvariant(command.type)))
	const output = yield* terminalService
		.output(entry.serverTerminalId)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* terminalService
		.kill(entry.serverTerminalId)
		.pipe(Effect.mapError(asTerminalInvariant(command.type)))
	yield* terminalService
		.release(entry.serverTerminalId)
		.pipe(Effect.catchTag("TerminalSessionLookupError", () => Effect.void))
	yield* registry.remove(command.terminalId)
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		cols: entry.cols,
		rows: entry.rows,
		output: capTerminalOutput(output.output),
		closed: true
	} satisfies OrchestrationCommand
})

export const fillTerminalCommand = Effect.fn("fillTerminalCommand")(function*(
	command: OrchestrationCommand
) {
	switch (command.type) {
		case "terminal.open":
			return yield* fillOpen(command)
		case "terminal.input":
			return yield* fillInput(command)
		case "terminal.resize":
			return yield* fillResize(command)
		case "terminal.close":
			return yield* fillClose(command)
		default:
			return command
	}
})
