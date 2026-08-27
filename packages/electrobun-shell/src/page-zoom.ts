import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

export const PageZoomRequest = Schema.Struct({
	level: Schema.Number,
})

export type PageZoomRequest = typeof PageZoomRequest.Type

export type PageZoomResponse = {
	readonly level: number | null
}

/**
 * Reads the zoom level off an untrusted setPageZoom request.
 *
 * The shell only checks that the level can reach WebKit at all. The product
 * range, how far the user may zoom, belongs to the webview's ZoomService,
 * which clamps before it asks. A malformed request answers null rather than
 * throwing, because an RPC handler that throws takes the bun process with it.
 */
export const resolvePageZoomLevel = (params: unknown): number | null => {
	const decoded = Schema.decodeUnknownEffect(PageZoomRequest)(params).pipe(
		Effect.result,
		Effect.runSync
	)
	if (Result.isFailure(decoded)) {
		return null
	}
	const level = decoded.success.level
	if (Number.isFinite(level) === false || level <= 0) {
		return null
	}
	return level
}
