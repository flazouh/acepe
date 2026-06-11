/**
 * AgentPanelScenePipelineController — owns the agent panel's scene assembly
 * pipeline: graph materializer → reveal-text projection → token-reveal overlay.
 * Hoisted from agent-panel.svelte (~620–735).
 */

import type { AgentPanelSceneEntryModel, AgentPanelSceneModel } from "@acepe/ui/agent-panel/types";
import type { ChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import { createAgentPanelGraphMaterializerReadModel } from "../../../session-state/agent-panel-graph-materializer.js";
import type { AgentPanelGraphMaterializerInput } from "../../../session-state/agent-panel-graph-materializer-types.js";
import { createGraphSceneEntryIndexReadModel } from "../logic/graph-scene-entry-match.js";
import { createRevealTextProjection } from "../logic/reveal-text-projection.js";
import { createTokenRevealSceneReadModel } from "../logic/token-reveal-scene-read-model.js";
import { buildTokenRevealCss } from "../components/agent-panel-pure-helpers.js";
import { resolveTokenRevealSettleDelayMs } from "../../messages/token-reveal-motion.js";
import type { ContentScrollRevealController } from "./content-scroll-reveal-controller.svelte.js";

export interface AgentPanelScenePipelineControllerDeps {
	getSessionId: () => string | null;
	getGraphMaterializerInput: () => AgentPanelGraphMaterializerInput;
	sessionStore: SessionStore;
	chatPreferencesStore: ChatPreferencesStore | null;
	getPrefersReducedMotion: () => boolean;
	contentScrollReveal: ContentScrollRevealController;
}

export class AgentPanelScenePipelineController {
	readonly #deps: AgentPanelScenePipelineControllerDeps;
	readonly #graphSceneMaterializer = createAgentPanelGraphMaterializerReadModel();
	readonly #revealTextProjection = createRevealTextProjection();
	readonly #tokenRevealSourceIndexReadModel = createGraphSceneEntryIndexReadModel();
	readonly #tokenRevealSceneReadModel = createTokenRevealSceneReadModel();

	constructor(deps: AgentPanelScenePipelineControllerDeps) {
		this.#deps = deps;
	}

	readonly graphMaterializedScene = $derived.by((): AgentPanelSceneModel => {
		return this.#graphSceneMaterializer.apply(this.#deps.getGraphMaterializerInput());
	});

	readonly graphSceneEntries = $derived.by((): readonly AgentPanelSceneEntryModel[] => {
		const sessionId = this.#deps.getSessionId();
		const turnCompleted =
			sessionId !== null && this.#deps.sessionStore.getSessionTurnState(sessionId) === "Completed";
		const turnId =
			sessionId === null
				? null
				: (this.#deps.sessionStore.getSessionLastTerminalTurnId(sessionId) ?? `${sessionId}:active`);
		return this.#revealTextProjection.apply({
			sceneEntries: this.graphMaterializedScene.conversation.entries,
			sessionId,
			turnId,
			turnCompleted,
		});
	});

	readonly tokenRevealSceneEntries = $derived.by((): readonly AgentPanelSceneEntryModel[] => {
		this.#deps.contentScrollReveal.settleRevision;
		const sessionId = this.#deps.getSessionId();
		const streamingAnimationMode =
			this.#deps.chatPreferencesStore?.streamingAnimationMode ?? "smooth";
		const tokenRevealTailRowId =
			sessionId === null ? null : this.#deps.sessionStore.getActiveStreamingTailRowId(sessionId);
		const clockAnchor = sessionId === null ? null : this.#deps.sessionStore.getClockAnchor(sessionId);

		const sourceEntries = this.graphMaterializedScene.conversation.entries;
		this.#tokenRevealSourceIndexReadModel.applyPatch(sourceEntries) ??
			this.#tokenRevealSourceIndexReadModel.applySnapshot(sourceEntries);
		const tailEntry = this.#tokenRevealSourceIndexReadModel.selectEntryById(tokenRevealTailRowId);
		const tailEntryIndex =
			this.#tokenRevealSourceIndexReadModel.selectEntryIndexById(tokenRevealTailRowId);
		const tokenRevealCss =
			tailEntry?.type === "assistant"
				? buildTokenRevealCss(
						sessionId === null
							? null
							: this.#deps.sessionStore.getRowTokenStreamByRowId(sessionId, tailEntry.id),
						clockAnchor,
						streamingAnimationMode,
						this.#deps.getPrefersReducedMotion(),
						tailEntry.isStreaming === true
					)
				: undefined;
		const tokenRevealSnapshot = {
			sceneEntries: this.graphSceneEntries,
			sourceEntry: tailEntry,
			tailRowId: tokenRevealTailRowId,
			tailRowIndex: tailEntryIndex,
			tokenRevealCss,
		};

		return (
			this.#tokenRevealSceneReadModel.applyPatch(tokenRevealSnapshot) ??
			this.#tokenRevealSceneReadModel.applySnapshot(tokenRevealSnapshot)
		);
	});

	readonly tokenRevealSettleDelayMs = $derived(
		resolveTokenRevealSettleDelayMs(this.#tokenRevealSceneReadModel.selectSettlingTimings())
	);
}
