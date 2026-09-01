import { RpcTransportError } from "@acepe/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type { ElectrobunRpcBridge } from "./client.ts";

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
		readonly readTextFile?: unknown;
		readonly writeTextFile?: unknown;
		readonly getDefaultShell?: unknown;
		readonly gitCall?: unknown;
		readonly getProviderAccountUsage?: unknown;
		readonly listProviderSessions?: unknown;
		readonly listProviderProjects?: unknown;
		readonly importProviderSession?: unknown;
	};
	return (
		Predicate.isFunction(request.ping) &&
		Predicate.isFunction(request.dispatch) &&
		Predicate.isFunction(request.snapshot) &&
		Predicate.isFunction(request.events) &&
		Predicate.isFunction(request.getProjectIndex) &&
		Predicate.isFunction(request.invalidateProjectIndex) &&
		Predicate.isFunction(request.readTextFile) &&
		Predicate.isFunction(request.writeTextFile) &&
		Predicate.isFunction(request.getDefaultShell) &&
		Predicate.isFunction(request.gitCall) &&
		Predicate.isFunction(request.getProviderAccountUsage) &&
		Predicate.isFunction(request.listProviderSessions) &&
		Predicate.isFunction(request.listProviderProjects) &&
		Predicate.isFunction(request.importProviderSession) &&
		Predicate.isFunction(record.addMessageListener) &&
		Predicate.isFunction(record.removeMessageListener)
	);
};

export const bindElectrobunBridge = (bridge: ElectrobunRpcBridge): void => {
	HOLDER.__acepeElectrobunRpc = bridge;
};

export const clearElectrobunBridge = (): void => {
	HOLDER.__acepeElectrobunRpc = undefined;
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

// The handshake message. The shell's ping handler echoes it back, so a
// matching echo proves the whole window -> socket -> shell -> socket -> window
// path is live -- not merely that the bridge object exists.
export const READY_PING_MESSAGE = "acepe-transport-ready";

// The socket connects a beat after Electroview is constructed. 40 x 50ms gives
// the connection two seconds to come up -- the same budget the install import
// already allows -- and no more, so a genuinely dead transport fails fast
// instead of hanging the app.
const DEFAULT_READY_ATTEMPTS = 40;
const DEFAULT_READY_DELAY = Duration.millis(50);

export interface TransportReadyOptions {
	readonly attempts?: number;
	readonly delay?: Duration.Duration;
}

const pingEchoesHandshake = (value: unknown): boolean =>
	Predicate.isObject(value) && (value as { readonly echo?: unknown }).echo === READY_PING_MESSAGE;

const pingRoundTrips = (bridge: ElectrobunRpcBridge): Effect.Effect<void, RpcTransportError> =>
	Effect.tryPromise({
		try: () => bridge.request.ping({ message: READY_PING_MESSAGE }),
		catch: transportErrorFrom,
	}).pipe(
		Effect.flatMap((response) =>
			pingEchoesHandshake(response)
				? Effect.void
				: Effect.fail(new RpcTransportError({ reason: "transport ping echo mismatch" }))
		)
	);

/**
 * Waits for the transport to actually round-trip a ping before the client is
 * handed out.
 *
 * The reek this replaces: readiness was inferred from the bridge OBJECT
 * existing (a synchronous shape check), while the socket behind it connects
 * asynchronously. In the bundled build the object appears first and the socket
 * a beat later, so the first burst of startup RPCs -- session updates, agents,
 * voice, the inbound-request handler -- raced the handshake and failed hard,
 * one initialization-failed card for whichever lost. Every one of those callers
 * reaches the transport through the single memoised `appRpcClient()`, so gating
 * that one accessor on a proven round-trip makes readiness deterministic for
 * all of them at once, with no per-caller retry.
 */
export const probeTransportReady = (
	bridge: ElectrobunRpcBridge,
	options: TransportReadyOptions = {}
): Effect.Effect<void, RpcTransportError> => {
	const attempts = options.attempts ?? DEFAULT_READY_ATTEMPTS;
	const delay = options.delay ?? DEFAULT_READY_DELAY;
	const loop = (remaining: number): Effect.Effect<void, RpcTransportError> =>
		pingRoundTrips(bridge).pipe(
			Effect.catch((error) =>
				remaining <= 0
					? Effect.fail(error)
					: Effect.sleep(delay).pipe(Effect.flatMap(() => loop(remaining - 1)))
			)
		);
	return loop(attempts);
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
						// Electrobun defaults this to one second, which is shorter than
						// several honest requests the app makes: dictation holds the
						// stop command while a local speech model transcribes, seconds
						// warm and about a minute the first time the model is read from
						// disk. The transcription arrived and the transport had already
						// given up on it, leaving "RPC request timed out" as the only
						// account of a mic that seemed to do nothing.
						maxRequestTime: 120_000,
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
						})
					),
			})
		);
		if (isElectrobunRpcBridge(loaded) === false) {
			markBoot("mismatch");
			return yield* new RpcTransportError({ reason: "electrobun webview rpc shape mismatch" });
		}
		// Prove the socket round-trips before binding: a bound bridge is then
		// always a connected one, so every consumer of appRpcClient() is
		// guaranteed a live transport rather than racing the handshake.
		markBoot("probing");
		yield* probeTransportReady(loaded);
		bindElectrobunBridge(loaded);
		markBoot("bound");
		return loaded;
	});
