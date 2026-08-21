import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const PtySignal = Schema.Literals(["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"])
export type PtySignal = typeof PtySignal.Type

export class PtySpawnError extends Schema.TaggedError<PtySpawnError>()("PtySpawnError", {
	adapter: Schema.String,
	shell: Schema.String,
	detail: Schema.String
}) {
	override get message(): string {
		return `Failed to spawn PTY process '${this.shell}' with ${this.adapter}: ${this.detail}`
	}
}

export type PtyExitEvent = {
	readonly exitCode: number
	readonly signal: number | null
}

export type PtyProcess = {
	readonly pid: number
	readonly write: (data: string) => void
	readonly resize: (cols: number, rows: number) => void
	readonly kill: (signal?: PtySignal) => void
	readonly onData: (callback: (data: string) => void) => () => void
	readonly onExit: (callback: (event: PtyExitEvent) => void) => () => void
}

export type PtySpawnInput = {
	readonly shell: string
	readonly args: ReadonlyArray<string>
	readonly cwd: string
	readonly cols: number
	readonly rows: number
	readonly env: { [key: string]: string }
}

export interface PtyAdapterShape {
	readonly spawn: (input: PtySpawnInput) => Effect.Effect<PtyProcess, PtySpawnError>
}

export class PtyAdapter extends Context.Service<PtyAdapter, PtyAdapterShape>()(
	"@acepe/server/terminal/Services/PtyAdapter"
) {}
