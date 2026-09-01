import {
	type AgentCallRequest,
	decodeAgentCallExit,
	decodeDispatchExit,
	decodeGetDefaultShellExit,
	decodeGetProjectIndexExit,
	decodeGetProviderAccountUsageExit,
	decodeGitCallExit,
	decodeImportProviderSessionExit,
	decodeInvalidateProjectIndexExit,
	decodeListProviderProjectsExit,
	decodeListProviderSessionsExit,
	decodeOrchestrationEvent,
	decodeReadImageDataUrlExit,
	decodeReadTextFileExit,
	decodeSnapshotExit,
	decodeWriteTextFileExit,
	encodeOrchestrationCommand,
	exitToEffect,
	type GetDefaultShellRequest,
	type GetProviderAccountUsageRequest,
	type GitCallRequest,
	type ImportProviderSessionRequest,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type ReadImageDataUrlRequest,
	type ReadTextFileRequest,
	type RpcClientError,
	RpcSchemaError,
	RpcServerError,
	type RpcTransport,
	RpcTransportError,
	type Sequence,
	type SnapshotRequest,
	type TrimmedNonEmptyString,
	type WriteTextFileRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/**
 * Every shell request has the same shape, so it gets one named type. Repeating
 * the signature inline once per request grew the structural work TypeScript
 * does on the surrounding Effect unions until inference gave up and widened
 * their requirement channel to `any`.
 */
type ElectrobunRpcRequest = (params: unknown) => Promise<unknown>;

export type ElectrobunRpcBridge = {
	readonly request: {
		readonly ping: ElectrobunRpcRequest;
		readonly dispatch: ElectrobunRpcRequest;
		readonly snapshot: ElectrobunRpcRequest;
		readonly events: ElectrobunRpcRequest;
		readonly getProjectIndex: ElectrobunRpcRequest;
		readonly invalidateProjectIndex: ElectrobunRpcRequest;
		readonly readTextFile: ElectrobunRpcRequest;
		readonly readImageDataUrl: ElectrobunRpcRequest;
		readonly writeTextFile: ElectrobunRpcRequest;
		readonly getDefaultShell: ElectrobunRpcRequest;
		readonly gitCall: ElectrobunRpcRequest;
		readonly agentCall: ElectrobunRpcRequest;
		readonly getProviderAccountUsage: ElectrobunRpcRequest;
		readonly listProviderSessions: ElectrobunRpcRequest;
		readonly listProviderProjects: ElectrobunRpcRequest;
		readonly importProviderSession: ElectrobunRpcRequest;
		readonly setPageZoom: ElectrobunRpcRequest;
		readonly getAppVersion: ElectrobunRpcRequest;
		readonly checkForUpdate: ElectrobunRpcRequest;
		readonly downloadUpdate: ElectrobunRpcRequest;
		readonly applyUpdate: ElectrobunRpcRequest;
		readonly updateDownloadProgress: ElectrobunRpcRequest;
		readonly relaunchApp: ElectrobunRpcRequest;
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

const requestReadTextFile = Effect.fn("requestReadTextFile")(function* (
	bridge: ElectrobunRpcBridge,
	request: ReadTextFileRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.readTextFile(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeReadTextFileExit(encoded);
	return yield* exitToEffect(exit);
});

const requestReadImageDataUrl = Effect.fn("requestReadImageDataUrl")(function* (
	bridge: ElectrobunRpcBridge,
	request: ReadImageDataUrlRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.readImageDataUrl(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeReadImageDataUrlExit(encoded);
	return yield* exitToEffect(exit);
});

const requestWriteTextFile = Effect.fn("requestWriteTextFile")(function* (
	bridge: ElectrobunRpcBridge,
	request: WriteTextFileRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.writeTextFile(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeWriteTextFileExit(encoded);
	return yield* exitToEffect(exit);
});

const requestGetDefaultShell = Effect.fn("requestGetDefaultShell")(function* (
	bridge: ElectrobunRpcBridge,
	request: GetDefaultShellRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.getDefaultShell(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeGetDefaultShellExit(encoded);
	return yield* exitToEffect(exit);
});

const requestGitCall = Effect.fn("requestGitCall")(function* (
	bridge: ElectrobunRpcBridge,
	request: GitCallRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.gitCall(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeGitCallExit(encoded);
	return yield* exitToEffect(exit);
});

const requestAgentCall = Effect.fn("requestAgentCall")(function* (
	bridge: ElectrobunRpcBridge,
	request: AgentCallRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.agentCall(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeAgentCallExit(encoded);
	return yield* exitToEffect(exit);
});

const requestGetProviderAccountUsage = Effect.fn("requestGetProviderAccountUsage")(function* (
	bridge: ElectrobunRpcBridge,
	request: GetProviderAccountUsageRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.getProviderAccountUsage(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeGetProviderAccountUsageExit(encoded);
	return yield* exitToEffect(exit);
});

const requestListProviderSessions = Effect.fn("requestListProviderSessions")(function* (
	bridge: ElectrobunRpcBridge,
	projectPath: TrimmedNonEmptyString
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.listProviderSessions({ projectPath }),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeListProviderSessionsExit(encoded);
	return yield* exitToEffect(exit);
});

const requestListProviderProjects = Effect.fn("requestListProviderProjects")(function* (
	bridge: ElectrobunRpcBridge
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.listProviderProjects({}),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeListProviderProjectsExit(encoded);
	return yield* exitToEffect(exit);
});

const requestImportProviderSession = Effect.fn("requestImportProviderSession")(function* (
	bridge: ElectrobunRpcBridge,
	request: ImportProviderSessionRequest
) {
	const encoded = yield* Effect.tryPromise({
		try: () => bridge.request.importProviderSession(request),
		catch: transportErrorFrom,
	});
	const exit = yield* decodeImportProviderSessionExit(encoded);
	return yield* exitToEffect(exit);
});

// QA-only diagnostic counter (acepe#261): proves whether the webview's
// "events" message listener is ever invoked at all, independent of whether
// the decoded payload later turns out to be well-formed. Read via
// qa-dispatch-hook.ts's window.__acepeQaEventsPushReceived.
let eventsPushReceivedCount = 0;
export const readEventsPushReceivedCount = (): number => eventsPushReceivedCount;

const listenForEvents = (
	bridge: ElectrobunRpcBridge,
	fromSequence: Sequence
): Stream.Stream<OrchestrationEvent, RpcClientError> =>
	Stream.callback<unknown, RpcClientError>((queue) =>
		Effect.gen(function* () {
			const listener = (payload: unknown) => {
				eventsPushReceivedCount += 1;
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
			return yield* Effect.never;
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
	snapshot: (request) => requestSnapshot(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	getProjectIndex: (projectPath) =>
		requestGetProjectIndex(bridge, projectPath).pipe(Effect.mapError(toRpcClientError)),
	invalidateProjectIndex: (projectPath) =>
		requestInvalidateProjectIndex(bridge, projectPath).pipe(Effect.mapError(toRpcClientError)),
	readTextFile: (request) =>
		requestReadTextFile(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	readImageDataUrl: (request) =>
		requestReadImageDataUrl(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	writeTextFile: (request) =>
		requestWriteTextFile(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	getDefaultShell: () => requestGetDefaultShell(bridge, {}).pipe(Effect.mapError(toRpcClientError)),
	gitCall: (request) => requestGitCall(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	agentCall: (request) => requestAgentCall(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	getProviderAccountUsage: (request) =>
		requestGetProviderAccountUsage(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	listProviderSessions: (projectPath) =>
		requestListProviderSessions(bridge, projectPath).pipe(Effect.mapError(toRpcClientError)),
	listProviderProjects: () =>
		requestListProviderProjects(bridge).pipe(Effect.mapError(toRpcClientError)),
	importProviderSession: (request) =>
		requestImportProviderSession(bridge, request).pipe(Effect.mapError(toRpcClientError)),
	events: (fromSequence) => listenForEvents(bridge, fromSequence),
});

// HMR: self-accepting. This module's live state is on globalThis (the bound
// bridge) or re-derivable (the client wrapper), so re-evaluating in place is
// safe, and it stops a transport edit from propagating up through every store
// to every component -- which remounted the whole app. Importers keep the
// references they hold; new transport code loads on the next reload.
if (import.meta.hot) {
	import.meta.hot.accept();
}
