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

/**
 * Ask for an image as a `data:` URI rather than a path.
 *
 * The webview refuses `file://` URLs, so a local image cannot be shown by
 * pointing an `<img>` at it: the request is dropped and the element reports
 * `naturalWidth === 0` without an error. Sending the bytes back inline is what
 * makes a project's own logo renderable at all.
 */
export const ReadImageDataUrlRequest = Schema.Struct({
	path: TrimmedNonEmptyString,
})
export type ReadImageDataUrlRequest = typeof ReadImageDataUrlRequest.Type

export const WriteTextFileRequest = Schema.Struct({
	path: TrimmedNonEmptyString,
	content: Schema.String,
	sessionId: SessionId,
})
export type WriteTextFileRequest = typeof WriteTextFileRequest.Type

export const GetDefaultShellRequest = Schema.Struct({})
export type GetDefaultShellRequest = typeof GetDefaultShellRequest.Type
