import { SessionId, TerminalCols, TerminalId, TerminalRows, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { TerminalId as ServerTerminalId } from "./TerminalService.ts"

// Bridges a client-chosen contracts TerminalId (carried on every terminal.*
// command) to the server-internal TerminalId that TerminalService assigns
// when it spawns the PTY (see TerminalService.open, which always mints a
// fresh id). It also remembers the terminal's cwd/cols/rows, since
// TerminalService.output() only reports the output buffer and exit status,
// not the terminal's size or working directory.
export type TerminalRegistryEntry = {
	readonly serverTerminalId: ServerTerminalId
	readonly sessionId: SessionId
	readonly cwd: TrimmedNonEmptyString
	readonly cols: TerminalCols
	readonly rows: TerminalRows
}

export class TerminalRegistryLookupError extends Schema.TaggedError<TerminalRegistryLookupError>()(
	"TerminalRegistryLookupError",
	{
		terminalId: TerminalId
	}
) {
	override get message(): string {
		return `No open terminal registered for '${this.terminalId}'.`
	}
}

export interface TerminalRegistryShape {
	readonly register: (
		terminalId: TerminalId,
		entry: TerminalRegistryEntry
	) => Effect.Effect<void>
	readonly require: (
		terminalId: TerminalId
	) => Effect.Effect<TerminalRegistryEntry, TerminalRegistryLookupError>
	readonly updateSize: (
		terminalId: TerminalId,
		cols: TerminalCols,
		rows: TerminalRows
	) => Effect.Effect<void, TerminalRegistryLookupError>
	readonly remove: (terminalId: TerminalId) => Effect.Effect<void>
}

export class TerminalRegistry extends Context.Service<TerminalRegistry, TerminalRegistryShape>()(
	"@acepe/server/terminal/Services/TerminalRegistry"
) {}
