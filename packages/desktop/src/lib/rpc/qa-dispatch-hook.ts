import type {
	AgentCallRequest,
	AgentCallResult,
	OrchestrationCommand,
	RpcDispatchResult,
	RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import { librarySnapshotRequest, sessionSnapshotRequest } from "@acepe/contracts";
import * as Effect from "effect/Effect";
import { appRpcClient } from "./app-client.ts";
import { readEventsPushReceivedCount } from "./client.ts";

declare global {
	interface Window {
		__acepeQaDispatch?: (command: OrchestrationCommand) => Promise<RpcDispatchResult>;
		__acepeQaSessionSnapshot?: (sessionId: string) => Promise<RpcSessionSnapshot>;
		__acepeQaLibrarySnapshot?: () => Promise<RpcSessionSnapshot>;
		__acepeQaEventsPushReceived?: () => number;
		__acepeQaAgentCall?: (request: AgentCallRequest) => Promise<AgentCallResult>;
	}
}

// QA-only debug hook: lets an electrobun-qa `js()` script dispatch a raw
// OrchestrationCommand straight through the app's real RpcClient — e.g.
// session.create with a real providerId, which the normal UI flow doesn't
// yet have a picker for. Mirrors the existing window.__acepe* debug hooks in
// this codebase (see panel-open-performance-mark.ts). Not a new capability:
// dispatch() is already the app's one write path into the orchestration
// engine, this just gives a QA script a way to call it directly instead of
// driving the UI pixel by pixel.
export const installQaDispatchHook = (): void => {
	window.__acepeQaDispatch = (command) =>
		Effect.runPromise(Effect.flatMap(appRpcClient(), (client) => client.dispatch(command)));
	// QA-only read counterpart: a direct query.snapshot round trip so a QA
	// script can verify a session's real projected messages (server-side
	// truth, independent of whatever the UI has rendered) without reaching
	// into component internals.
	window.__acepeQaSessionSnapshot = (sessionId) =>
		Effect.runPromise(
			Effect.flatMap(appRpcClient(), (client) =>
				client.snapshot(sessionSnapshotRequest(sessionId as SessionId))
			)
		);
	// QA-only read counterpart: the library-scoped snapshot (every known
	// project + session row), so a QA script can find a real projectId
	// without guessing or reaching into ProjectManager's UI-side cache.
	window.__acepeQaLibrarySnapshot = () =>
		Effect.runPromise(
			Effect.flatMap(appRpcClient(), (client) => client.snapshot(librarySnapshotRequest()))
		);
	// QA-only diagnostic (acepe#261): the number of "events" bun->webview
	// pushes the RpcClient's listener has actually received, so a QA script
	// can compare it against the bun-side "acepe-events-stream: push" log
	// count to prove whether the transport delivers.
	window.__acepeQaEventsPushReceived = () => readEventsPushReceivedCount();
	// QA-only read/act counterpart for the agentCall utility RPC, the lane
	// the agent picker's install control and the panel's sign-in control both
	// ride. It lets a QA script prove what the server answers those controls
	// without a script having to reproduce the facade's own decoding.
	//
	// A sign-in op reached through here runs the same real login command the
	// button does, so a QA script must only name an agent whose sign-in
	// spawns nothing -- see the sign-in method on the agent list.
	window.__acepeQaAgentCall = (request) =>
		Effect.runPromise(Effect.flatMap(appRpcClient(), (client) => client.agentCall(request)));
};
