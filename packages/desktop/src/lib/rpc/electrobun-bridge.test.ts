import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";

import {
	bindElectrobunBridge,
	installElectrobunWebviewRpc,
	readElectrobunBridge,
} from "./electrobun-bridge.ts";
import type { ElectrobunRpcBridge } from "./client.ts";

const fakeBridge = (): ElectrobunRpcBridge => ({
	request: {
		dispatch: () => Promise.resolve(undefined),
		snapshot: () => Promise.resolve(undefined),
		events: () => Promise.resolve(undefined),
	},
	addMessageListener: () => undefined,
	removeMessageListener: () => undefined,
});

describe("electrobun-bridge", () => {
	it("reads a bound bridge", () => {
		const bridge = fakeBridge();
		bindElectrobunBridge(bridge);
		expect(readElectrobunBridge()).toBe(bridge);
	});

	it("returns the bound bridge from install without importing electrobun", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const bridge = fakeBridge();
				bindElectrobunBridge(bridge);
				const installed = yield* installElectrobunWebviewRpc();
				expect(installed).toBe(bridge);
			}),
		));
});
