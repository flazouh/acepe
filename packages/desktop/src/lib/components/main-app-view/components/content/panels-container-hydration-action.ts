import type { SessionStatus } from "$lib/acp/application/dto/session-status.js";

interface HydrationDecisionInput {
	readonly sessionId: string | null;
	readonly panelProjectPath: string | null;
	readonly panelAgentId: string | null;
	readonly hasSessionInStore: boolean;
	readonly isPreloaded: boolean;
	readonly hotStatus: SessionStatus | null;
}

type HydrationAction =
	| { readonly type: "none" }
	| { readonly type: "load_missing"; readonly projectPath: string; readonly agentId: string }
	| { readonly type: "preload" };

/**
 * Decide how to hydrate a restored panel session.
 *
 * Rules:
 * - If session metadata is missing from store and panel has enough context, load by ID.
 * - If session exists but entries are not preloaded, preload once.
 * - If already loading/preloaded, do nothing.
 */
export function deriveRestoredPanelHydrationAction(input: HydrationDecisionInput): HydrationAction {
	if (!input.sessionId) {
		return { type: "none" };
	}

	if (!input.hasSessionInStore) {
		if (input.panelProjectPath && input.panelAgentId) {
			return {
				type: "load_missing",
				projectPath: input.panelProjectPath,
				agentId: input.panelAgentId,
			};
		}
		return { type: "none" };
	}

	if (input.isPreloaded) {
		return { type: "none" };
	}

	if (input.hotStatus === "loading") {
		return { type: "none" };
	}

	return { type: "preload" };
}
