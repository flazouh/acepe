import type { OrchestrationCommand, RpcDispatchResult } from "@acepe/contracts"
import * as Effect from "effect/Effect"
import { appRpcClient } from "./app-client.ts"

declare global {
	interface Window {
		__acepeQaDispatch?: (command: OrchestrationCommand) => Promise<RpcDispatchResult>
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
		Effect.runPromise(
			Effect.flatMap(appRpcClient(), (client) => client.dispatch(command))
		)
}
