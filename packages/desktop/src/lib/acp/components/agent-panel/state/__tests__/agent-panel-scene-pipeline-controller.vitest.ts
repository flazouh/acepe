import { describe, expect, it } from "vitest";
import type { AgentPanelSceneModel } from "@acepe/ui/agent-panel/types";
import type { ChatPreferencesStore } from "../../../../store/chat-preferences-store.svelte.js";
import type { SessionStore } from "../../../../store/session-store.svelte.js";
import type { AgentPanelGraphMaterializerInput } from "../../../../session-state/agent-panel-graph-materializer-types.js";
import { ContentScrollRevealController } from "../content-scroll-reveal-controller.svelte.js";
import { AgentPanelScenePipelineController } from "../agent-panel-scene-pipeline-controller.svelte.js";

describe("AgentPanelScenePipelineController", () => {
	const contentScrollReveal = new ContentScrollRevealController();

	const emptyScene: AgentPanelSceneModel = {
		panelId: "panel-1",
		status: "empty",
		header: {
			title: "Session",
			subtitle: null,
			status: "empty",
			agentLabel: null,
			projectLabel: null,
			projectColor: null,
			branchLabel: null,
			badges: [],
			actions: [],
		},
		conversation: { entries: [], isStreaming: false },
		composer: null,
		strips: [],
		cards: [],
		sidebars: { plan: null },
		chrome: null,
	};

	const make = (overrides?: {
		sessionId?: string | null;
		input?: AgentPanelGraphMaterializerInput;
	}) => {
		const holder = {
			sessionId: overrides?.sessionId ?? null,
			input: overrides?.input ?? { panelId: "panel-1", graph: null, header: { title: "Session" } },
			prefersReducedMotion: false,
		};
		const sessionStore = {
			getSessionTurnState: () => "Running" as const,
			getSessionLastTerminalTurnId: () => null,
			getActiveStreamingTailRowId: () => null,
			getClockAnchor: () => null,
			getRowTokenStreamByRowId: () => null,
		} as unknown as SessionStore;

		const controller = new AgentPanelScenePipelineController({
			getSessionId: () => holder.sessionId,
			getGraphMaterializerInput: () => holder.input,
			sessionStore,
			chatPreferencesStore: null as unknown as ChatPreferencesStore,
			getPrefersReducedMotion: () => holder.prefersReducedMotion,
			contentScrollReveal,
		});

		return { controller, holder };
	};

	it("materializes the scene from graph materializer input", () => {
		const { controller } = make({
			input: {
				panelId: "panel-1",
				graph: null,
				header: { title: "My session" },
			},
		});
		expect(controller.graphMaterializedScene.header.title).toBe("My session");
	});

	it("projects reveal text over materialized scene entries", () => {
		const { controller } = make();
		expect(controller.graphSceneEntries).toEqual(controller.graphMaterializedScene.conversation.entries);
	});

	it("exposes token-reveal scene entries and settle delay", () => {
		const { controller } = make();
		expect(controller.tokenRevealSceneEntries).toEqual(controller.graphSceneEntries);
		expect(controller.tokenRevealSettleDelayMs).toBeNull();
	});

	it("reflects sessionId changes through accessors at read time", () => {
		const { controller, holder } = make({ sessionId: "s1" });
		expect(controller.graphSceneEntries).toBeDefined();
		holder.sessionId = "s2";
		expect(controller.graphSceneEntries).toBeDefined();
	});
});
