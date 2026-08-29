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
