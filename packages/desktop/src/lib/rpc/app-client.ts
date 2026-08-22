import type { RpcClient } from "@acepe/contracts";
import { makeResumingRpcClient } from "@acepe/contracts";
import * as Effect from "effect/Effect";

import { makeElectrobunRpcTransport } from "./client.ts";
import { installElectrobunWebviewRpc } from "./electrobun-bridge.ts";

/**
 * The one app-level RpcClient.
 *
 * This is the expand step of the Tauri migration: components reach the
 * contract through this accessor while tauri-command-client.ts still exists
 * untouched beside it. Batches then move call sites over one directory at a
 * time, and the contract step deletes the Tauri client once no importer
 * remains.
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
				Effect.orDie,
			);

/** Test seam: swap the client without touching the webview bridge. */
export const setAppRpcClientForTest = (next: RpcClient | null): void => {
	client = next;
};
