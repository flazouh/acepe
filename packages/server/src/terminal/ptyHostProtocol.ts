import * as Schema from "effect/Schema"

export const PtyHostSpawnCommand = Schema.Struct({
	op: Schema.Literal("spawn"),
	shell: Schema.String,
	args: Schema.Array(Schema.String),
	cwd: Schema.String,
	cols: Schema.Int.check(Schema.isGreaterThan(0)),
	rows: Schema.Int.check(Schema.isGreaterThan(0)),
	env: Schema.Record(Schema.String, Schema.String)
})
export type PtyHostSpawnCommand = typeof PtyHostSpawnCommand.Type

export const PtyHostWriteCommand = Schema.Struct({
	op: Schema.Literal("write"),
	data: Schema.String
})
export type PtyHostWriteCommand = typeof PtyHostWriteCommand.Type

export const PtyHostResizeCommand = Schema.Struct({
	op: Schema.Literal("resize"),
	cols: Schema.Int.check(Schema.isGreaterThan(0)),
	rows: Schema.Int.check(Schema.isGreaterThan(0))
})
export type PtyHostResizeCommand = typeof PtyHostResizeCommand.Type

export const PtyHostKillCommand = Schema.Struct({
	op: Schema.Literal("kill"),
	signal: Schema.optionalKey(Schema.Literals(["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"]))
})
export type PtyHostKillCommand = typeof PtyHostKillCommand.Type

export const PtyHostCommand = Schema.Union([
	PtyHostSpawnCommand,
	PtyHostWriteCommand,
	PtyHostResizeCommand,
	PtyHostKillCommand
])
export type PtyHostCommand = typeof PtyHostCommand.Type

export const PtyHostReadyEvent = Schema.Struct({
	op: Schema.Literal("ready"),
	pid: Schema.Int.check(Schema.isGreaterThan(0))
})
export type PtyHostReadyEvent = typeof PtyHostReadyEvent.Type

export const PtyHostDataEvent = Schema.Struct({
	op: Schema.Literal("data"),
	data: Schema.String
})
export type PtyHostDataEvent = typeof PtyHostDataEvent.Type

export const PtyHostExitEvent = Schema.Struct({
	op: Schema.Literal("exit"),
	exitCode: Schema.NullOr(Schema.Int),
	signal: Schema.NullOr(Schema.Number)
})
export type PtyHostExitEvent = typeof PtyHostExitEvent.Type

export const PtyHostErrorEvent = Schema.Struct({
	op: Schema.Literal("error"),
	detail: Schema.String
})
export type PtyHostErrorEvent = typeof PtyHostErrorEvent.Type

export const PtyHostEvent = Schema.Union([
	PtyHostReadyEvent,
	PtyHostDataEvent,
	PtyHostExitEvent,
	PtyHostErrorEvent
])
export type PtyHostEvent = typeof PtyHostEvent.Type

export const encodePtyHostCommand = Schema.encodeEffect(Schema.fromJsonString(PtyHostCommand))
export const encodePtyHostEvent = Schema.encodeEffect(Schema.fromJsonString(PtyHostEvent))
export const decodePtyHostEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(PtyHostEvent))
export const decodePtyHostCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(PtyHostCommand))
