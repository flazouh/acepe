import { describe, expect, it } from "bun:test";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { ElectrobunRpcBridge } from "./client.ts";
import {
	bindElectrobunBridge,
	installElectrobunWebviewRpc,
	isElectrobunRpcBridge,
	probeTransportReady,
	READY_PING_MESSAGE,
	readElectrobunBridge,
} from "./electrobun-bridge.ts";

const fakeBridge = (
	ping: ElectrobunRpcBridge["request"]["ping"] = () =>
		Promise.resolve({ echo: "desktop round trip" })
): ElectrobunRpcBridge => ({
	request: {
		ping,
		dispatch: () => Promise.resolve(undefined),
		snapshot: () => Promise.resolve(undefined),
		events: () => Promise.resolve(undefined),
		getProjectIndex: () => Promise.resolve(undefined),
		invalidateProjectIndex: () => Promise.resolve(undefined),
		readImageDataUrl: () => Promise.resolve(undefined),
		readTextFile: () => Promise.resolve(undefined),
		writeTextFile: () => Promise.resolve(undefined),
		getDefaultShell: () => Promise.resolve(undefined),
		gitCall: () => Promise.resolve(undefined),
		agentCall: () => Promise.resolve(undefined),
		getProviderAccountUsage: () => Promise.resolve(undefined),
		listProviderSessions: () => Promise.resolve(undefined),
		listProviderProjects: () => Promise.resolve(undefined),
		importProviderSession: () => Promise.resolve(undefined),
		setPageZoom: () => Promise.resolve(undefined),
		getAppVersion: () => Promise.resolve(undefined),
		checkForUpdate: () => Promise.resolve(undefined),
		downloadUpdate: () => Promise.resolve(undefined),
		applyUpdate: () => Promise.resolve(undefined),
		updateDownloadProgress: () => Promise.resolve(undefined),
		relaunchApp: () => Promise.resolve(undefined),
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
			readImageDataUrl: () => Promise.resolve(undefined),
			readTextFile: () => Promise.resolve(undefined),
			writeTextFile: () => Promise.resolve(undefined),
			getDefaultShell: () => Promise.resolve(undefined),
			gitCall: () => Promise.resolve(undefined),
			agentCall: () => Promise.resolve(undefined),
			getProviderAccountUsage: () => Promise.resolve(undefined),
			listProviderSessions: () => Promise.resolve(undefined),
			listProviderProjects: () => Promise.resolve(undefined),
			importProviderSession: () => Promise.resolve(undefined),
		});
		expect(
			isElectrobunRpcBridge({
				request,
				addMessageListener: () => undefined,
				removeMessageListener: () => undefined,
			})
		).toBe(true);
	});

	it("returns the bound bridge from install without importing electrobun", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const bridge = fakeBridge();
				bindElectrobunBridge(bridge);
				const installed = yield* installElectrobunWebviewRpc();
				expect(installed).toBe(bridge);
			})
		));

	// The reek this closes: readiness used to mean "the bridge object exists",
	// a synchronous shape check, not "the transport round-trips". In the
	// bundled build the socket connects a beat after the object appears, so the
	// first burst of init RPCs (session updates, agents, voice, inbound) raced
	// the handshake and failed hard. The gate proves readiness with one real
	// ping before the client is handed out.
	it("probeTransportReady resolves once a ping round-trips", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let attempts = 0;
				const bridge = fakeBridge(() => {
					attempts += 1;
					if (attempts < 3) {
						return Promise.reject(new Error("socket not connected yet"));
					}
					return Promise.resolve({ echo: READY_PING_MESSAGE });
				});
				yield* probeTransportReady(bridge, { attempts: 5, delay: Duration.millis(1) });
				expect(attempts).toBe(3);
			})
		));

	it("probeTransportReady fails after the deadline when the transport never answers", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const bridge = fakeBridge(() => Promise.reject(new Error("socket dead")));
				const result = yield* Effect.flip(
					probeTransportReady(bridge, { attempts: 3, delay: Duration.millis(1) })
				);
				expect(result._tag).toBe("RpcTransportError");
			})
		));

	it("probeTransportReady rejects a wrong echo as not-ready", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const bridge = fakeBridge(() => Promise.resolve({ echo: "not-the-handshake" }));
				const result = yield* Effect.flip(
					probeTransportReady(bridge, { attempts: 2, delay: Duration.millis(1) })
				);
				expect(result._tag).toBe("RpcTransportError");
			})
		));

	// A ping that never settles used to hang the probe for good: the loop awaited
	// a promise with no deadline, so attempt 1 never finished and attempts 2..N
	// never ran. Live, that stranded the page's own install inside the probe --
	// `rpcClient` stayed null and the window rendered the empty pending shell (a
	// black app) while a second, racing install bound a working bridge behind it.
	// Each attempt is now time-boxed, so a dead ping is retried like a failed one.
	it("probeTransportReady retries a ping that never settles", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let attempts = 0;
				const bridge = fakeBridge(() => {
					attempts += 1;
					if (attempts < 2) {
						// Never settles: the socket accepted the call and went quiet.
						return new Promise(() => undefined);
					}
					return Promise.resolve({ echo: READY_PING_MESSAGE });
				});
				yield* probeTransportReady(bridge, {
					attempts: 4,
					delay: Duration.millis(1),
					timeout: Duration.millis(20),
				});
				expect(attempts).toBe(2);
			})
		));

	it("probeTransportReady gives up when every ping hangs", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const bridge = fakeBridge(() => new Promise(() => undefined));
				const result = yield* Effect.flip(
					probeTransportReady(bridge, {
						attempts: 2,
						delay: Duration.millis(1),
						timeout: Duration.millis(20),
					})
				);
				expect(result._tag).toBe("RpcTransportError");
			})
		));
});
