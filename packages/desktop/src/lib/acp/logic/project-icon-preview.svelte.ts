import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { SvelteMap } from "svelte/reactivity";

import { backendClient } from "$lib/utils/backend-client.js";

/**
 * Local images the app has already turned into data URIs.
 *
 * A value of null means the read failed and must not be retried: a file over
 * the inline size cap, or one that vanished. Storing the failure is what keeps
 * a broken path from asking the server again on every render.
 */
const previews = new SvelteMap<string, string | null>();
const inflight = new Set<string>();

export type ImageLoader = (absolutePath: string) => Promise<string | null>;

const defaultLoader: ImageLoader = async (absolutePath) => {
	const result = await Effect.runPromise(
		Effect.result(backendClient.fs.readImageDataUrl(absolutePath))
	);
	return Result.isFailure(result) ? null : result.success;
};

/**
 * The data URI for a local image, or null until one is available.
 *
 * Reading this from a `$derived` is what makes a badge fill in: the first call
 * starts the read and answers null, and the SvelteMap write when it lands
 * re-runs the deriving expression.
 *
 * This exists because the webview refuses `file://` URLs. An `<img>` pointed
 * at a path on disk fails silently, reporting `naturalWidth === 0`, so the
 * bytes have to come over RPC and go in as a data URI.
 */
export function projectIconPreview(
	absolutePath: string | null | undefined,
	loader: ImageLoader = defaultLoader
): string | null {
	if (absolutePath === null || absolutePath === undefined || absolutePath.length === 0) {
		return null;
	}
	const cached = previews.get(absolutePath);
	if (cached !== undefined) {
		return cached;
	}
	if (inflight.has(absolutePath) === false) {
		inflight.add(absolutePath);
		void loader(absolutePath).then((dataUrl) => {
			inflight.delete(absolutePath);
			previews.set(absolutePath, dataUrl);
		});
	}
	return null;
}

/** Forget one path, so the next read of it goes back to the server. */
export function forgetProjectIconPreview(absolutePath: string): void {
	previews.delete(absolutePath);
}

/** Forget everything. Used by tests to isolate cases from each other. */
export function resetProjectIconPreviews(): void {
	previews.clear();
	inflight.clear();
}
