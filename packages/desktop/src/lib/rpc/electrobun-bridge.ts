import type { ElectrobunRpcBridge } from "./client.ts";
import { RpcTransportError } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

const HOLDER = globalThis as {
	__acepeElectrobunRpc?: ElectrobunRpcBridge;
};

const isBridge = (value: unknown): value is ElectrobunRpcBridge => {
	if (Predicate.isObject(value) === false) {
		return false;
	}
	const record = value as {
		readonly request?: unknown;
		readonly addMessageListener?: unknown;
		readonly removeMessageListener?: unknown;
	};
	if (Predicate.isObject(record.request) === false) {
		return false;
	}
	const request = record.request as {
		readonly dispatch?: unknown;
		readonly snapshot?: unknown;
		readonly events?: unknown;
		readonly getProjectIndex?: unknown;
		readonly invalidateProjectIndex?: unknown;
	};
	return (
		Predicate.isFunction(request.dispatch) &&
		Predicate.isFunction(request.snapshot) &&
		Predicate.isFunction(request.events) &&
		Predicate.isFunction(request.getProjectIndex) &&
		Predicate.isFunction(request.invalidateProjectIndex) &&
		Predicate.isFunction(record.addMessageListener) &&
		Predicate.isFunction(record.removeMessageListener)
	);
};

export const bindElectrobunBridge = (bridge: ElectrobunRpcBridge): void => {
	HOLDER.__acepeElectrobunRpc = bridge;
};

export const readElectrobunBridge = (): ElectrobunRpcBridge | null => {
	const bound = HOLDER.__acepeElectrobunRpc;
	if (bound !== undefined) {
		return bound;
	}
	return null;
};

const transportErrorFrom = (cause: unknown): RpcTransportError => {
	if (Predicate.isError(cause)) {
		return new RpcTransportError({ reason: cause.message });
	}
	return new RpcTransportError({ reason: "electrobun webview rpc failed" });
};

export const installElectrobunWebviewRpc = (): Effect.Effect<
	ElectrobunRpcBridge,
	RpcTransportError
> =>
	Effect.gen(function* () {
		const existing = readElectrobunBridge();
		if (existing !== null) {
			return existing;
		}
		const loaded = yield* Effect.tryPromise({
			try: () =>
				import("electrobun/view").then((mod) => {
					const rpc = mod.Electroview.defineRPC({
						handlers: {
							requests: {},
							messages: {},
						},
					});
					const view = new mod.Electroview({ rpc });
					return view.rpc;
				}),
			catch: transportErrorFrom,
		});
		if (isBridge(loaded) === false) {
			return yield* new RpcTransportError({ reason: "electrobun webview rpc shape mismatch" });
		}
		bindElectrobunBridge(loaded);
		return loaded;
	});
