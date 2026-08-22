import type { ElectrobunRpcBridge } from "./client.ts";
import { RpcTransportError } from "@acepe/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

const HOLDER = globalThis as {
	__acepeElectrobunRpc?: ElectrobunRpcBridge;
	__acepeElectrobunBoot?: string;
};

const markBoot = (step: string): void => {
	HOLDER.__acepeElectrobunBoot = step;
};

export const isElectrobunRpcBridge = (value: unknown): value is ElectrobunRpcBridge => {
	if (Predicate.isObject(value) === false) {
		return false;
	}
	const record = value as {
		readonly request?: unknown;
		readonly addMessageListener?: unknown;
		readonly removeMessageListener?: unknown;
	};
	const requestHolder = record.request;
	if (
		Predicate.isObject(requestHolder) === false &&
		Predicate.isFunction(requestHolder) === false
	) {
		return false;
	}
	const request = requestHolder as {
		readonly ping?: unknown;
		readonly dispatch?: unknown;
		readonly snapshot?: unknown;
		readonly events?: unknown;
		readonly getProjectIndex?: unknown;
		readonly invalidateProjectIndex?: unknown;
	};
	return (
		Predicate.isFunction(request.ping) &&
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
		markBoot("install");
		const loaded = yield* Effect.tryPromise({
			try: () => {
				markBoot("importing");
				return import("electrobun/view").then((mod) => {
					markBoot("imported");
					const rpc = mod.Electroview.defineRPC({
						handlers: {
							requests: {},
							messages: {},
						},
					});
					markBoot("defined");
					const view = new mod.Electroview({ rpc });
					markBoot("constructed");
					return view.rpc;
				});
			},
			catch: transportErrorFrom,
		}).pipe(
			Effect.timeoutOrElse({
				duration: Duration.seconds(2),
				orElse: () =>
					Effect.fail(
						new RpcTransportError({
							reason: `electrobun rpc install timed out at ${HOLDER.__acepeElectrobunBoot ?? "unknown"}`,
						}),
					),
			}),
		);
		if (isElectrobunRpcBridge(loaded) === false) {
			markBoot("mismatch");
			return yield* new RpcTransportError({ reason: "electrobun webview rpc shape mismatch" });
		}
		bindElectrobunBridge(loaded);
		markBoot("bound");
		return loaded;
	});
