import type { RpcClient } from "@acepe/contracts";
import { makeResumingRpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { makeElectrobunRpcTransport } from "./client.ts";
import { installElectrobunWebviewRpc } from "./electrobun-bridge.ts";

/**
 * The one app-level RpcClient.
 *
 * Every facade reaches the contract through this accessor.
 *
 * Memoised because the webview bridge must only be installed once; a second
 * Electroview would register a second RPC schema against the same window.
 */
let client: RpcClient | null = null;

export const appRpcClient = (): Effect.Effect<RpcClient, never> =>
	client !== null
		? Effect.succeed(client)
		: installElectrobunWebviewRpc().pipe(
				Effect.map((bridge) => {
					const made = makeResumingRpcClient(makeElectrobunRpcTransport(bridge));
					client = made;
					return made;
				}),
				Effect.orDie
			);

export const provideAppRpcClient = (next: RpcClient | null): void => {
	client = next;
};

/** Test seam: swap the client without touching the webview bridge. */
export const setAppRpcClientForTest = provideAppRpcClient;

// HMR: self-accepting. This module's live state is on globalThis (the bound
// bridge) or re-derivable (the client wrapper), so re-evaluating in place is
// safe, and it stops a transport edit from propagating up through every store
// to every component -- which remounted the whole app. Importers keep the
// references they hold; new transport code loads on the next reload.
if (import.meta.hot) {
	import.meta.hot.accept();
}
