import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId, TerminalId } from "./ids.ts"

export const TERMINAL_OUTPUT_CAP = 64_000
export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const TerminalCols = PositiveInt
export type TerminalCols = typeof TerminalCols.Type

export const TerminalRows = PositiveInt
export type TerminalRows = typeof TerminalRows.Type

export const ProjectedTerminal = Schema.Struct({
	sequence: Sequence,
	terminalId: TerminalId,
	sessionId: SessionId,
	cwd: TrimmedNonEmptyString,
	cols: TerminalCols,
	rows: TerminalRows,
	output: Schema.String,
	closed: Schema.Boolean,
})
export type ProjectedTerminal = typeof ProjectedTerminal.Type

export const emptyProjectedTerminal = (
	terminalId: TerminalId,
	sessionId: SessionId,
	cwd: TrimmedNonEmptyString,
	sequence: Sequence,
): ProjectedTerminal => ({
	sequence,
	terminalId,
	sessionId,
	cwd,
	cols: DEFAULT_TERMINAL_COLS,
	rows: DEFAULT_TERMINAL_ROWS,
	output: "",
	closed: false,
})

export const capTerminalOutput = (output: string): string => {
	if (output.length <= TERMINAL_OUTPUT_CAP) {
		return output
	}
	return output.slice(output.length - TERMINAL_OUTPUT_CAP)
}
