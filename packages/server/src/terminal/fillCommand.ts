import {
	capTerminalOutput,
	DEFAULT_TERMINAL_COLS,
	DEFAULT_TERMINAL_ROWS,
	type OrchestrationCommand
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts"
import { TerminalRegistry, type TerminalRegistryEntry } from "./Services/TerminalRegistry.ts"
import { TerminalService, type TerminalError } from "./Services/TerminalService.ts"
import type { TerminalRegistryLookupError } from "./Services/TerminalRegistry.ts"

const asTerminalInvariant = (commandType: string) => (error: TerminalError | TerminalRegistryLookupError) =>
	new OrchestrationCommandInvariantError({
		commandType,
		detail: error.message
	})

const runTerminal = <A>(
	commandType: string,
	program: Effect.Effect<A, TerminalError | TerminalRegistryLookupError>
) => program.pipe(Effect.mapError(asTerminalInvariant(commandType)))

// Every filled terminal command reports the entry's live size/output snapshot
// back onto the command (see orchestration.ts's comment on the terminal
// command schemas); `cols`/`rows` differ only for terminal.resize, which is
// filling in the size the client asked for rather than the registry's
// current one.
const filledOutputFields = Effect.fn("filledTerminalOutputFields")(function*(
	commandType: string,
	entry: TerminalRegistryEntry,
	size: { readonly cols: number; readonly rows: number }
) {
	const terminalService = yield* TerminalService
	const output = yield* runTerminal(commandType, terminalService.output(entry.serverTerminalId))
	return {
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		cols: size.cols,
		rows: size.rows,
		output: capTerminalOutput(output.output),
		closed: output.exitStatus !== null
	}
})

const fillOpen = Effect.fn("fillTerminalOpen")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.open" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const cols = command.cols ?? DEFAULT_TERMINAL_COLS
	const rows = command.rows ?? DEFAULT_TERMINAL_ROWS
	const handle = yield* runTerminal(
		command.type,
		terminalService.open({ sessionId: command.sessionId, cwd: command.cwd, cols, rows })
	)
	const entry: TerminalRegistryEntry = {
		serverTerminalId: handle.terminalId,
		sessionId: command.sessionId,
		cwd: command.cwd,
		cols,
		rows
	}
	yield* registry.register(command.terminalId, entry)
	const fields = yield* filledOutputFields(command.type, entry, entry)
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		...fields
	} satisfies OrchestrationCommand
})

const fillInput = Effect.fn("fillTerminalInput")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.input" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* runTerminal(command.type, registry.require(command.terminalId))
	yield* runTerminal(command.type, terminalService.write(entry.serverTerminalId, command.data))
	const fields = yield* filledOutputFields(command.type, entry, entry)
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		data: command.data,
		...fields
	} satisfies OrchestrationCommand
})

const fillResize = Effect.fn("fillTerminalResize")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.resize" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* runTerminal(command.type, registry.require(command.terminalId))
	const size = { cols: command.cols, rows: command.rows }
	yield* runTerminal(command.type, terminalService.resize(entry.serverTerminalId, size.cols, size.rows))
	yield* runTerminal(command.type, registry.updateSize(command.terminalId, size.cols, size.rows))
	const fields = yield* filledOutputFields(command.type, entry, size)
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		...fields
	} satisfies OrchestrationCommand
})

const fillClose = Effect.fn("fillTerminalClose")(function*(
	command: Extract<OrchestrationCommand, { readonly type: "terminal.close" }>
) {
	const terminalService = yield* TerminalService
	const registry = yield* TerminalRegistry
	const entry = yield* runTerminal(command.type, registry.require(command.terminalId))
	const fields = yield* filledOutputFields(command.type, entry, entry)
	yield* runTerminal(command.type, terminalService.kill(entry.serverTerminalId))
	yield* terminalService
		.release(entry.serverTerminalId)
		.pipe(Effect.catchTag("TerminalSessionLookupError", () => Effect.void))
	yield* registry.remove(command.terminalId)
	return {
		type: command.type,
		commandId: command.commandId,
		terminalId: command.terminalId,
		...fields,
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
