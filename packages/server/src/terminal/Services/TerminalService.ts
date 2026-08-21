import { SessionId, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { PtySignal, PtySpawnError } from "./PtyAdapter.ts"

export const TerminalId = Schema.Trim.check(Schema.isNonEmpty()).pipe(Schema.brand("TerminalId"))
export type TerminalId = typeof TerminalId.Type
export const decodeTerminalId = Schema.decodeUnknownEffect(TerminalId)

export const TerminalCols = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
	Schema.isLessThanOrEqualTo(1000)
)
export type TerminalCols = typeof TerminalCols.Type

export const TerminalRows = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(
	Schema.isLessThanOrEqualTo(500)
)
export type TerminalRows = typeof TerminalRows.Type

export const EnvVariable = Schema.Struct({
	name: Schema.String.check(Schema.isNonEmpty()),
	value: Schema.String
})
export type EnvVariable = typeof EnvVariable.Type

export const OpenTerminalInput = Schema.Struct({
	sessionId: SessionId,
	cwd: TrimmedNonEmptyString,
	cols: Schema.optionalKey(TerminalCols),
	rows: Schema.optionalKey(TerminalRows),
	env: EnvVariable.pipe(Schema.Array, Schema.optionalKey),
	outputByteLimit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
	command: Schema.optionalKey(TrimmedNonEmptyString),
	shell: Schema.optionalKey(TrimmedNonEmptyString)
})
export type OpenTerminalInput = typeof OpenTerminalInput.Type

export const TerminalHandle = Schema.Struct({
	terminalId: TerminalId,
	sessionId: SessionId,
	pid: Schema.Int.check(Schema.isGreaterThan(0)),
	shell: TrimmedNonEmptyString
})
export type TerminalHandle = typeof TerminalHandle.Type

export const TerminalExitStatus = Schema.Struct({
	exitCode: Schema.NullOr(Schema.Int),
	signal: Schema.NullOr(Schema.String)
})
export type TerminalExitStatus = typeof TerminalExitStatus.Type

export const TerminalOutput = Schema.Struct({
	output: Schema.String,
	truncated: Schema.Boolean,
	exitStatus: Schema.NullOr(TerminalExitStatus)
})
export type TerminalOutput = typeof TerminalOutput.Type

export class TerminalCwdNotFoundError extends Schema.TaggedError<TerminalCwdNotFoundError>()(
	"TerminalCwdNotFoundError",
	{
		cwd: Schema.String
	}
) {
	override get message(): string {
		return `Terminal cwd does not exist: ${this.cwd}`
	}
}

export class TerminalCwdNotDirectoryError extends Schema.TaggedError<TerminalCwdNotDirectoryError>()(
	"TerminalCwdNotDirectoryError",
	{
		cwd: Schema.String
	}
) {
	override get message(): string {
		return `Terminal cwd is not a directory: ${this.cwd}`
	}
}

export class TerminalCwdStatError extends Schema.TaggedError<TerminalCwdStatError>()(
	"TerminalCwdStatError",
	{
		cwd: Schema.String,
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Failed to access terminal cwd '${this.cwd}': ${this.detail}`
	}
}

export class TerminalSessionLookupError extends Schema.TaggedError<TerminalSessionLookupError>()(
	"TerminalSessionLookupError",
	{
		terminalId: TerminalId
	}
) {
	override get message(): string {
		return `Unknown terminal: ${this.terminalId}`
	}
}

export class TerminalNotRunningError extends Schema.TaggedError<TerminalNotRunningError>()(
	"TerminalNotRunningError",
	{
		terminalId: TerminalId
	}
) {
	override get message(): string {
		return `Terminal is not running: ${this.terminalId}`
	}
}

export class TerminalWriteError extends Schema.TaggedError<TerminalWriteError>()("TerminalWriteError", {
	terminalId: TerminalId,
	pid: Schema.Number,
	detail: Schema.String
}) {
	override get message(): string {
		return `Failed to write to terminal ${this.terminalId} (pid ${this.pid}): ${this.detail}`
	}
}

export class TerminalResizeError extends Schema.TaggedError<TerminalResizeError>()(
	"TerminalResizeError",
	{
		terminalId: TerminalId,
		pid: Schema.Number,
		cols: TerminalCols,
		rows: TerminalRows,
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Failed to resize terminal ${this.terminalId} (pid ${this.pid}) to ${this.cols}x${this.rows}: ${this.detail}`
	}
}

export class TerminalSignalError extends Schema.TaggedError<TerminalSignalError>()(
	"TerminalSignalError",
	{
		terminalId: TerminalId,
		pid: Schema.Number,
		signal: PtySignal,
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Failed to send ${this.signal} to terminal ${this.terminalId} (pid ${this.pid}): ${this.detail}`
	}
}

export class TerminalOpenError extends Schema.TaggedError<TerminalOpenError>()("TerminalOpenError", {
	detail: Schema.String
}) {
	override get message(): string {
		return `Failed to open terminal: ${this.detail}`
	}
}

export type TerminalError =
	| PtySpawnError
	| TerminalCwdNotFoundError
	| TerminalCwdNotDirectoryError
	| TerminalCwdStatError
	| TerminalSessionLookupError
	| TerminalNotRunningError
	| TerminalWriteError
	| TerminalResizeError
	| TerminalSignalError
	| TerminalOpenError

export interface TerminalServiceShape {
	readonly open: (input: OpenTerminalInput) => Effect.Effect<TerminalHandle, TerminalError>
	readonly write: (terminalId: TerminalId, data: string) => Effect.Effect<void, TerminalError>
	readonly resize: (
		terminalId: TerminalId,
		cols: TerminalCols,
		rows: TerminalRows
	) => Effect.Effect<void, TerminalError>
	readonly signal: (terminalId: TerminalId, signal: PtySignal) => Effect.Effect<void, TerminalError>
	readonly output: (terminalId: TerminalId) => Effect.Effect<TerminalOutput, TerminalSessionLookupError>
	readonly waitForExit: (
		terminalId: TerminalId
	) => Effect.Effect<TerminalExitStatus, TerminalSessionLookupError>
	readonly kill: (terminalId: TerminalId) => Effect.Effect<void, TerminalError>
	readonly release: (terminalId: TerminalId) => Effect.Effect<void, TerminalSessionLookupError>
	readonly releaseSession: (sessionId: SessionId) => Effect.Effect<void>
}

export class TerminalService extends Context.Service<TerminalService, TerminalServiceShape>()(
	"@acepe/server/terminal/Services/TerminalService"
) {}
