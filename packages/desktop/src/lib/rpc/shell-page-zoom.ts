import { RpcTransportError } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { readElectrobunBridge } from "./electrobun-bridge.js";

const logger = createLogger({
	id: LOGGER_IDS.ELECTROBUN_SHIMS,
	name: "Shell Page Zoom",
});

/**
 * Zooms the whole shell window through the Bun process.
 *
 * WebKit page zoom is native, so only the Bun side can set it. The webview
 * asks over the shell RPC and keeps going when there is no shell to ask,
 * which is the case in the website preview and in unit tests.
 */
export const setShellPageZoom = (level: number): Effect.Effect<void> => {
	const bridge = readElectrobunBridge();
	if (bridge === null) {
		return Effect.void;
	}
	return Effect.tryPromise({
		try: () => bridge.request.setPageZoom({ level }),
		catch: (cause) =>
			new RpcTransportError({
				reason: cause instanceof Error ? cause.message : "shell page zoom request failed",
			}),
	}).pipe(
		Effect.asVoid,
		Effect.catch((error) =>
			Effect.sync(() => {
				logger.warn("setPageZoom request failed", { level, reason: error.reason });
			})
		)
	);
};
