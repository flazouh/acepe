import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { HistoryMalformedLineWarning } from "./Errors.ts"

export type JsonlDecodeResult<A> = {
	readonly rows: ReadonlyArray<A>
	readonly warnings: ReadonlyArray<HistoryMalformedLineWarning>
}

const decodeLine = <A>(schema: Schema.Codec<A>) =>
	Schema.decodeUnknownEffect(Schema.fromJsonString(schema))

export const decodeJsonl = Effect.fn("decodeJsonl")(function*<A>(
	schema: Schema.Codec<A>,
	content: string,
	path: string
) {
	const decode = decodeLine(schema)
	let rows: ReadonlyArray<A> = Arr.empty()
	let warnings: ReadonlyArray<HistoryMalformedLineWarning> = Arr.empty()
	const rawLines = Str.split(content, "\n")
	for (let index = 0; index < rawLines.length; index = index + 1) {
		const lineNumber = index + 1
		const raw = rawLines[index]
		if (raw === undefined) {
			continue
		}
		const line = raw.trim()
		if (line.length === 0) {
			continue
		}
		const parsed = yield* Effect.result(decode(line))
		if (Result.isFailure(parsed)) {
			const warning = new HistoryMalformedLineWarning({
				path,
				lineNumber,
				reason: parsed.failure.message
			})
			warnings = Arr.append(warnings, warning)
			yield* Effect.logWarning("Malformed history line skipped").pipe(
				Effect.annotateLogs({
					path,
					lineNumber,
					reason: warning.reason
				})
			)
			continue
		}
		rows = Arr.append(rows, parsed.success)
	}
	const result: JsonlDecodeResult<A> = {
		rows,
		warnings
	}
	return result
})
