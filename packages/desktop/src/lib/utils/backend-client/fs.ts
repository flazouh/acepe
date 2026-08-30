import { SessionId } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { AppError } from "../../acp/errors/app-error.js";
import { decodeEffect, withRpcClient } from "./rpc-bridge.ts";

const readTextFilePayload = (
	path: string,
	line: number | undefined,
	limit: number | undefined
) => ({
	path,
	...(line !== undefined ? { line } : {}),
	...(limit !== undefined ? { limit } : {}),
});

export const fs = {
	readTextFile: (path: string, line?: number, limit?: number): Effect.Effect<string, AppError> =>
		withRpcClient("fs.readTextFile", (client) =>
			client.readTextFile(readTextFilePayload(path, line, limit))
		),

	/**
	 * An image as a `data:` URI, ready to put straight in an `<img src>`.
	 *
	 * The webview will not load `file://` URLs from the app page, so a path is
	 * not enough to show a picture that lives on disk. The server reads the
	 * bytes and hands them back inline.
	 */
	readImageDataUrl: (path: string): Effect.Effect<string, AppError> =>
		withRpcClient("fs.readImageDataUrl", (client) => client.readImageDataUrl({ path })),

	writeTextFile: (
		path: string,
		content: string,
		sessionId: string
	): Effect.Effect<void, AppError> =>
		decodeEffect(
			"fs.writeTextFile",
			Schema.decodeUnknownEffect(SessionId)
		)(sessionId).pipe(
			Effect.flatMap((decodedSessionId) =>
				withRpcClient("fs.writeTextFile", (client) =>
					client.writeTextFile({ path, content, sessionId: decodedSessionId })
				)
			)
		),
};
