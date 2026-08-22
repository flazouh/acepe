import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";

import {
	bindElectrobunBridge,
	installElectrobunWebviewRpc,
	isElectrobunRpcBridge,
	readElectrobunBridge,
} from "./electrobun-bridge.ts";
import type { ElectrobunRpcBridge } from "./client.ts";

const fakeBridge = (): ElectrobunRpcBridge => ({
	request: {
		ping: () => Promise.resolve({ echo: "desktop round trip" }),
		dispatch: () => Promise.resolve(undefined),
		snapshot: () => Promise.resolve(undefined),
		events: () => Promise.resolve(undefined),
		getProjectIndex: () => Promise.resolve(undefined),
		invalidateProjectIndex: () => Promise.resolve(undefined),
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

	it("accepts a function-proxy request bag like Electroview.rpc.request", () => {
		const request = Object.assign(() => undefined, {
			ping: () => Promise.resolve({ echo: "desktop round trip" }),
			dispatch: () => Promise.resolve(undefined),
			snapshot: () => Promise.resolve(undefined),
			events: () => Promise.resolve(undefined),
			getProjectIndex: () => Promise.resolve(undefined),
			invalidateProjectIndex: () => Promise.resolve(undefined),
		});
		expect(
			isElectrobunRpcBridge({
				request,
				addMessageListener: () => undefined,
				removeMessageListener: () => undefined,
			}),
		).toBe(true);
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
