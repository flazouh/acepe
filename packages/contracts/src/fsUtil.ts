import { TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId } from "./ids.ts"
import * as Schema from "effect/Schema"

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const ReadTextFileRequest = Schema.Struct({
	path: TrimmedNonEmptyString,
	line: Schema.optionalKey(PositiveInt),
	limit: Schema.optionalKey(PositiveInt),
})
export type ReadTextFileRequest = typeof ReadTextFileRequest.Type

export const WriteTextFileRequest = Schema.Struct({
	path: TrimmedNonEmptyString,
	content: Schema.String,
	sessionId: SessionId,
})
export type WriteTextFileRequest = typeof WriteTextFileRequest.Type

export const GetDefaultShellRequest = Schema.Struct({})
export type GetDefaultShellRequest = typeof GetDefaultShellRequest.Type
