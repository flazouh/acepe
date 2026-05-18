import { describe, expect, it } from "bun:test";
import {
	applyAgentPanelDisplayMemory,
	applyAgentPanelDisplayModelToSceneEntries,
	buildAgentPanelBaseModel,
	createAgentPanelDisplayMemory,
} from "$lib/acp/components/agent-panel/logic/agent-panel-display-model.js";
import { materializeAgentPanelSceneFromGraph } from "$lib/acp/session-state/agent-panel-graph-materializer.js";

import {
	applyStreamingReproPhaseSceneOverrides,
	buildStreamingReproGraphMaterializerInput,
	getStreamingReproPresetById,
} from "../streaming-repro-graph-fixtures";

describe("streaming-repro-graph-fixtures", () => {
	it("builds a graph-backed thinking-only phase for the core preset", () => {
		const preset = getStreamingReproPresetById("core-streaming");
		const input = buildStreamingReproGraphMaterializerInput({
			panelId: "panel-debug",
			preset,
			phase: preset.phases[0],
		});
		const graph = input.graph;

		expect(graph).not.toBeNull();
		if (graph === null) {
			throw new Error("Expected graph fixture to produce a graph");
		}

		expect(graph.turnState).toBe("Running");
		expect(graph.activity.kind).toBe("awaiting_model");
		expect(graph.transcriptSnapshot.entries.map((entry) => entry.entryId)).toEqual(["user-1"]);
		expect(graph.lastAgentMessageId).toBeNull();
	});

	it("materializes a streaming assistant entry for the first-token phase", () => {
		const preset = getStreamingReproPresetById("core-streaming");
		const input = buildStreamingReproGraphMaterializerInput({
			panelId: "panel-debug",
			preset,
			phase: preset.phases[1],
		});

		const scene = materializeAgentPanelSceneFromGraph(input);
		const assistantEntry = scene.conversation.entries.find((entry) => entry.type === "assistant");

		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type === "assistant") {
			expect(assistantEntry.isStreaming).toBe(true);
			expect(assistantEntry.markdown).toContain("Umbrellas");
		}
	});

	it("keeps full canonical text during the first-word regression preset", () => {
		const preset = getStreamingReproPresetById("first-word-regression");
		let memory = createAgentPanelDisplayMemory();

		const firstWordInput = buildStreamingReproGraphMaterializerInput({
			panelId: "panel-debug",
			preset,
			phase: preset.phases[0],
		});
		const firstWordBaseModel = buildAgentPanelBaseModel({
			panelId: "panel-debug",
			graph: firstWordInput.graph,
			header: { title: preset.name },
			sceneEntries: materializeAgentPanelSceneFromGraph(firstWordInput).conversation.entries,
			local: {
				pendingSendIntent: false,
			},
		});
		const firstWordDisplay = applyAgentPanelDisplayMemory(memory, firstWordBaseModel);
		memory = firstWordDisplay.memory;

		const fullRewriteInput = buildStreamingReproGraphMaterializerInput({
			panelId: "panel-debug",
			preset,
			phase: preset.phases[1],
		});
		const fullRewriteScene = materializeAgentPanelSceneFromGraph(fullRewriteInput);
		const fullRewriteBaseModel = buildAgentPanelBaseModel({
			panelId: "panel-debug",
			graph: fullRewriteInput.graph,
			header: { title: preset.name },
			sceneEntries: fullRewriteScene.conversation.entries,
			local: {
				pendingSendIntent: false,
			},
		});
		const fullRewriteDisplay = applyAgentPanelDisplayMemory(memory, fullRewriteBaseModel);
		const projectedEntries = applyAgentPanelDisplayModelToSceneEntries(
			fullRewriteDisplay.model,
			fullRewriteDisplay.memory,
			fullRewriteScene.conversation.entries
		);
		const assistantEntry = projectedEntries.find((entry) => entry.type === "assistant");

		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type === "assistant") {
			expect(assistantEntry.markdown).toBe(preset.phases[1].assistantText);
			expect(assistantEntry.markdown).not.toBe("The");
		}
	});

	it("overrides the text/resource/text preset with real non-text message chunks", () => {
		const preset = getStreamingReproPresetById("text-resource-text");
		const input = buildStreamingReproGraphMaterializerInput({
			panelId: "panel-debug",
			preset,
			phase: preset.phases[0],
		});
		const scene = materializeAgentPanelSceneFromGraph(input);
		const entries = applyStreamingReproPhaseSceneOverrides({
			entries: scene.conversation.entries,
			phase: preset.phases[0],
		});
		const assistantEntry = entries.find((entry) => entry.type === "assistant");

		expect(assistantEntry?.type).toBe("assistant");
		if (assistantEntry?.type !== "assistant") {
			throw new Error("Expected assistant entry");
		}
		expect(assistantEntry.message?.chunks).toEqual([
			{ type: "message", block: { type: "text", text: "Text before resource. " } },
			{
				type: "message",
				block: {
					type: "resource",
					resource: {
						uri: "file://debug-resource",
						text: "[debug resource]",
					},
				},
			},
			{
				type: "message",
				block: { type: "text", text: "Text after resource remains in order." },
			},
		]);
	});
});
