<script lang="ts">
import { countWordsInMarkdown } from "@acepe/ui/markdown";
import { onDestroy } from "svelte";
import type { PanelViewState } from "$lib/acp/logic/panel-visibility.js";
import type { SessionTurnState } from "$lib/services/acp-types.js";
import { materializeAgentPanelSceneFromGraph } from "$lib/acp/session-state/agent-panel-graph-materializer.js";
import AgentPanelContent from "$lib/acp/components/agent-panel/components/agent-panel-content.svelte";
import { Button } from "$lib/components/ui/button/index.js";

import {
	createStreamingReproController,
	type StreamingReproController,
} from "./streaming-repro-controller";
import {
	applyStreamingReproPhaseSceneOverrides,
	buildStreamingReproGraphMaterializerInput,
	getStreamingReproPresetById,
} from "./streaming-repro-graph-fixtures";
import { applyStreamingReproTokenReveal } from "./streaming-repro-token-reveal";

interface Props {
	controller?: StreamingReproController;
}

const DEFAULT_VIEW_STATE: PanelViewState = { kind: "conversation", errorDetails: null };
const DEFAULT_SESSION_ID = "streaming-repro-session";
const DEFAULT_PANEL_ID = "streaming-repro-panel";

let {
	controller = createStreamingReproController({
		now: () => Date.now(),
		hostMetrics: { width: 1280, height: 820 },
		theme: "dark",
	}),
}: Props = $props();

let controllerRevision = $state(0);
let phaseElapsedMs = $state(0);
let phaseAnimationStartedAtMs = $state(0);
let phaseAnimationRafId: number | null = null;

function readAnimationNowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function stopPhaseAnimationTick(): void {
	if (phaseAnimationRafId === null) {
		return;
	}
	cancelAnimationFrame(phaseAnimationRafId);
	phaseAnimationRafId = null;
}

function shouldAnimateActivePhase(): boolean {
	const phase = controller.activePhase;
	if (phase.lastAgentMessageId === null) {
		return false;
	}
	if (phase.reducedMotion === true || phase.streamingAnimationMode === "instant") {
		return false;
	}
	return countWordsInMarkdown(phase.assistantText) > 0;
}

function schedulePhaseAnimationTick(): void {
	if (!shouldAnimateActivePhase()) {
		stopPhaseAnimationTick();
		return;
	}
	if (phaseAnimationRafId !== null) {
		return;
	}
	phaseAnimationRafId = requestAnimationFrame((nowMs) => {
		phaseAnimationRafId = null;
		phaseElapsedMs = nowMs - phaseAnimationStartedAtMs;
		schedulePhaseAnimationTick();
	});
}

const activePhaseInput = $derived.by(() => {
	controllerRevision;
	const preset = getStreamingReproPresetById(controller.activePreset.id);
	return buildStreamingReproGraphMaterializerInput({
		panelId: DEFAULT_PANEL_ID,
		preset,
		phase: controller.activePhase,
	});
});
const activePhaseLabel = $derived.by(() => {
	controllerRevision;
	return controller.activePhase.label;
});
const activeStepNumber = $derived.by(() => {
	controllerRevision;
	return controller.phaseIndex + 1;
});
const activeStepCount = $derived.by(() => {
	controllerRevision;
	return controller.activePreset.phases.length;
});

const materializedScene = $derived(materializeAgentPanelSceneFromGraph(activePhaseInput));
const reproSceneEntries = $derived(
	applyStreamingReproPhaseSceneOverrides({
		entries: materializedScene.conversation.entries,
		phase: controller.activePhase,
	})
);
const activeGraph = $derived(activePhaseInput.graph);
const projectedSceneEntries = $derived.by(() => {
	controllerRevision;
	phaseElapsedMs;
	return applyStreamingReproTokenReveal({
		entries: reproSceneEntries,
		preset: controller.activePreset,
		phaseIndex: controller.phaseIndex,
		phase: controller.activePhase,
		phaseElapsedMs,
	});
});

const turnState = $derived<SessionTurnState>(activeGraph?.turnState ?? "Completed");
const isWaitingForFirstAssistantText = $derived(
	activeGraph?.activity.kind === "awaiting_model" && activeGraph.lastAgentMessageId === null
);

function nextPhase(): void {
	if (controller.phaseIndex >= controller.activePreset.phases.length - 1) {
		controller.reset();
	} else {
		controller.nextPhase();
	}
	controllerRevision += 1;
}

function resetPhaseAnimation(): void {
	stopPhaseAnimationTick();
	phaseAnimationStartedAtMs = readAnimationNowMs();
	phaseElapsedMs = 0;
	schedulePhaseAnimationTick();
}

$effect(() => {
	controllerRevision;
	resetPhaseAnimation();

	return () => {
		stopPhaseAnimationTick();
	};
});

onDestroy(() => {
	stopPhaseAnimationTick();
});
</script>

<div
	class="flex h-full min-h-0 w-full flex-col gap-3"
	data-testid="streaming-repro-lab"
>
	<div class="flex items-center justify-between gap-4">
		<div>
			<div class="text-sm font-medium text-foreground">Streaming Repro Lab</div>
			<div class="text-xs text-muted-foreground">
				{activePhaseLabel} · Step {activeStepNumber} of {activeStepCount}
			</div>
		</div>
		<Button size="sm" onclick={nextPhase}>Next</Button>
	</div>

	<div class="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background">
		<AgentPanelContent
			panelId={DEFAULT_PANEL_ID}
			viewState={DEFAULT_VIEW_STATE}
			sessionId={DEFAULT_SESSION_ID}
			sceneEntries={projectedSceneEntries}
			sessionProjectPath={activeGraph?.projectPath ?? null}
			allProjects={[]}
			isAtBottom={true}
			isAtTop={true}
			isStreaming={turnState === "Running"}
			agentIconSrc=""
			isFullscreen={false}
			availableAgents={[]}
			effectiveTheme={controller.theme}
			modifiedFilesState={null}
			isWaitingForResponse={isWaitingForFirstAssistantText}
		/>
	</div>
</div>
