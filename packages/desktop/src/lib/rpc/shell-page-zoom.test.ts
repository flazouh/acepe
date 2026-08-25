import { beforeEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { ElectrobunRpcBridge } from "./client.ts";
import { bindElectrobunBridge, clearElectrobunBridge } from "./electrobun-bridge.ts";
import { setShellPageZoom } from "./shell-page-zoom.ts";

const bridgeWith = (setPageZoom: (params: unknown) => Promise<unknown>): ElectrobunRpcBridge =>
	({
		request: {
			setPageZoom,
		},
		addMessageListener: () => undefined,
		removeMessageListener: () => undefined,
	}) as unknown as ElectrobunRpcBridge;

describe("setShellPageZoom", () => {
	beforeEach(() => {
		clearElectrobunBridge();
	});

	it("asks the shell window to zoom the page", async () => {
		const calls: Array<unknown> = [];
		bindElectrobunBridge(
			bridgeWith((params) => {
				calls.push(params);
				return Promise.resolve({ level: 1.2 });
			})
		);

		await Effect.runPromise(setShellPageZoom(1.2));

		expect(calls).toEqual([{ level: 1.2 }]);
	});

	it("succeeds without a bridge, so a browser preview never crashes", async () => {
		await Effect.runPromise(setShellPageZoom(1.2));
	});

	it("survives a shell that rejects the request", async () => {
		let attempts = 0;
		bindElectrobunBridge(
			bridgeWith(() => {
				attempts += 1;
				return Promise.reject(new Error("rpc gone"));
			})
		);

		await Effect.runPromise(setShellPageZoom(1.2));

		expect(attempts).toBe(1);
	});
});
