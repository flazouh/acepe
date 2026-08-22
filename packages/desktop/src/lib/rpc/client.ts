import {
	decodeDispatchExit,
	decodeGetProjectIndexExit,
	decodeInvalidateProjectIndexExit,
	decodeOrchestrationEvent,
	decodeSnapshotExit,
	encodeOrchestrationCommand,
	exitToEffect,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type RpcClientError,
	RpcSchemaError,
	RpcServerError,
	type RpcTransport,
	RpcTransportError,
	type Sequence,
	type SnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

export type ElectrobunRpcBridge = {
	readonly request: {
		readonly ping: (params: unknown) => Promise<unknown>;
		readonly dispatch: (params: unknown) => Promise<unknown>;
		readonly snapshot: (params: unknown) => Promise<unknown>;
		readonly events: (params: unknown) => Promise<unknown>;
		readonly getProjectIndex: (params: unknown) => Promise<unknown>;
		readonly invalidateProjectIndex: (params: unknown) => Promise<unknown>;
	};
	readonly addMessageListener: (message: "events", listener: (payload: unknown) => void) => void;
	readonly removeMessageListener: (message: "events", listener: (payload: unknown) => void) => void;
};

const transportErrorFrom = (cause: unknown): RpcTransportError => {
	if (Predicate.isError(cause)) {
		return new RpcTransportError({ reason: cause.message });
	}
	return new RpcTransportError({ reason: "electrobun rpc failed" });
};

const toRpcClientError = (error: RpcClientError | Schema.SchemaError): RpcClientError => {
	if (Schema.is(RpcTransportError)(error)) {
		return error;
	}
	if (Schema.is(RpcServerError)(error)) {
		return error;
	}
	return new RpcSchemaError({ issue: error.message });
};

const requestDispatch = Effect.fn("requestDispatch")(function* (
	bridge: ElectrobunRpcBridge,
	command: OrchestrationCommand
) {
	const params = yield* encodeOrchestrationCommand(command);
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.dispatch(params),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeDispatchExit(encoded);
	return yield* exitToEffect(exit);
});

const requestSnapshot = Effect.fn("requestSnapshot")(function* (
	bridge: ElectrobunRpcBridge,
	request: SnapshotRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.snapshot(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeSnapshotExit(encoded);
	return yield* exitToEffect(exit);
});

const requestGetProjectIndex = Effect.fn("requestGetProjectIndex")(function* (
	bridge: ElectrobunRpcBridge,
	projectPath: string
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.getProjectIndex({ projectPath }),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeGetProjectIndexExit(encoded);
	return yield* exitToEffect(exit);
});

const requestInvalidateProjectIndex = Effect.fn("requestInvalidateProjectIndex")(function* (
	bridge: ElectrobunRpcBridge,
	projectPath: string
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.invalidateProjectIndex({ projectPath }),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeInvalidateProjectIndexExit(encoded);
	return yield* exitToEffect(exit);
});

const listenForEvents = (
	bridge: ElectrobunRpcBridge,
	fromSequence: Sequence
): Stream.Stream<OrchestrationEvent, RpcClientError> =>
	Stream.callback<unknown, RpcClientError>((queue) =>
		Effect.gen(function* () {
			const listener = (payload: unknown) => {
				Queue.offerUnsafe(queue, payload);
			};
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					bridge.addMessageListener("events", listener);
				}),
				() =>
					Effect.sync(() => {
						bridge.removeMessageListener("events", listener);
					})
			);
			yield* Effect.tryPromise({
				try: () => bridge.request.events({ fromSequence }),
				catch: transportErrorFrom,
			});
			yield* Effect.never;
		})
	).pipe(
		Stream.mapEffect((payload) =>
			decodeOrchestrationEvent(payload).pipe(
				Effect.mapError((error) => new RpcSchemaError({ issue: error.message }))
			)
		)
	);

export const makeElectrobunRpcTransport = (bridge: ElectrobunRpcBridge): RpcTransport => ({
	dispatch: (command) => requestDispatch(bridge, command).pipe(Effect.mapError(toRpcClientError)),
	snapshot: (request) =>
		requestSnapshot(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	getProjectIndex: (projectPath) =>
		requestGetProjectIndex(bridge, projectPath).pipe(Effect.mapError(toRpcClientError)),
	invalidateProjectIndex: (projectPath) =>
		requestInvalidateProjectIndex(bridge, projectPath).pipe(Effect.mapError(toRpcClientError)),
	events: (fromSequence) => listenForEvents(bridge, fromSequence),
});
