import {
	hasProjectIconExtension,
	type ReadImageDataUrlRequest,
	RpcSchemaError
} from "@acepe/contracts"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as Path from "effect/Path"

/**
 * How big an image may be before it is refused.
 *
 * A data URI travels inside a JSON-RPC reply and then lives as a string in the
 * webview, and base64 adds a third on top. A project logo is kilobytes; a
 * multi-megabyte photograph is not what this is for, and inlining one would
 * cost far more than it shows.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const MEDIA_TYPES: Record<string, string> = {
	svg: "image/svg+xml",
	png: "image/png",
	ico: "image/x-icon",
	webp: "image/webp",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif"
}

const notAbsolute = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Path must be absolute: ${rawPath}` })

const notAnImage = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Not an image this webview can render: ${rawPath}` })

const cannotAccess = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Cannot access path: ${rawPath}` })

const tooLarge = (rawPath: string, size: number): RpcSchemaError =>
	new RpcSchemaError({
		issue: `Image is ${size} bytes, over the ${MAX_IMAGE_BYTES} byte limit: ${rawPath}`
	})

const readFailed = (rawPath: string): RpcSchemaError =>
	new RpcSchemaError({ issue: `Failed to read image: ${rawPath}` })

/** The media type for a path, or null when the extension is not one we serve. */
export const imageMediaType = (filePath: string): string | null => {
	const dot = filePath.lastIndexOf(".")
	if (dot === -1) {
		return null
	}
	return MEDIA_TYPES[filePath.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * Read an image and return it as a `data:` URI.
 *
 * This exists because the webview will not load `file://` URLs from the app
 * page: the request is dropped and the `<img>` reports `naturalWidth === 0`
 * with no error, so a local picture silently never appears. Handing back the
 * bytes inline is the way to show a file that lives on the user's disk.
 *
 * Path confinement is enforced by the RPC handler before this runs, the same
 * way readTextFile is guarded -- see packages/server/src/rpc/fsPathGuard.ts.
 */
export const readImageDataUrl = Effect.fn("fsUtil.readImageDataUrl")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	request: ReadImageDataUrlRequest
) {
	if (path.isAbsolute(request.path) === false) {
		return yield* notAbsolute(request.path)
	}
	// Checked before touching the disk: the extension decides the media type,
	// so a path we cannot name a type for is refused rather than served as
	// something the browser has to guess at.
	if (hasProjectIconExtension(request.path) === false) {
		return yield* notAnImage(request.path)
	}
	const mediaType = imageMediaType(request.path)
	if (mediaType === null) {
		return yield* notAnImage(request.path)
	}
	const realPath = yield* fs.realPath(request.path).pipe(
		Effect.mapError(() => cannotAccess(request.path))
	)
	const info = yield* fs.stat(realPath).pipe(Effect.mapError(() => cannotAccess(request.path)))
	const size = Number(info.size)
	if (size > MAX_IMAGE_BYTES) {
		return yield* tooLarge(request.path, size)
	}
	const bytes = yield* fs.readFile(realPath).pipe(Effect.mapError(() => readFailed(request.path)))
	return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`
})
