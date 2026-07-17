<script lang="ts">
import { onMount, tick } from "svelte";
import type { PanelViewState } from "$lib/acp/logic/panel-visibility.js";
import type { SessionTurnState, TranscriptEntry, TranscriptViewportRow } from "$lib/services/acp-types.js";
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

interface Props {
	controller?: StreamingReproController;
}

type StreamingReproPerfStep = {
	readonly phaseId: string;
	readonly label: string;
	readonly phaseIndex: number;
	readonly assistantTextLength: number;
	readonly turnState: SessionTurnState;
	readonly domFlushMs: number;
	readonly rowCount: number;
	readonly animatedTokenSpans: number;
	readonly tokenRevealMode: string | null;
};

type StreamingReproPerfProbeResult = {
	readonly presetId: string;
	readonly phaseCount: number;
	readonly totalMs: number;
	readonly visibilityState: string;
	readonly documentHasFocus: boolean | null;
	readonly steps: readonly StreamingReproPerfStep[];
};

declare global {
	interface Window {
		__acepeStreamingReproPerfProbe?: () => Promise<StreamingReproPerfProbeResult>;
	}
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
let labElement: HTMLDivElement | null = $state(null);

function readAnimationNowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

async function waitForDomFlush(): Promise<void> {
	await tick();
	await Promise.resolve();
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
const rowsProjectionOverride = $derived.by(() => {
	const rows = activeGraph.transcriptSnapshot.entries.map((entry) =>
		createStreamingReproViewportRow(entry)
	);
	const byId = new Map<string, TranscriptViewportRow>();
	const order: string[] = [];
	for (const row of rows) {
		order.push(row.rowId);
		byId.set(row.rowId, row);
	}
	return {
		sessionId: DEFAULT_SESSION_ID,
		emissionSeq: activeGraph.revision.transcriptRevision,
		revision: null,
		projectionVersion: null,
		totalRowCount: null,
		loadedStartRowIndex: null,
		loadedEndRowIndex: null,
		order,
		byId,
		rows,
	};
});
// Token-reveal projection removed (2026-07-17 teardown of the dead
// AgentPanelScenePipelineController pipeline). This now passes the
// materialized+overridden scene entries straight through; the rebuild's
// client-side presentation buffer will re-point this derived to its own
// projection.
const projectedSceneEntries = $derived(reproSceneEntries);

const turnState = $derived<SessionTurnState>(activeGraph?.turnState ?? "Completed");
const isWaitingForFirstAssistantText = $derived(
	activeGraph?.activity.kind === "awaiting_model" && activeGraph.activeStreamingTail === null
);

function entryTextLength(entry: TranscriptEntry): number {
	let length = 0;
	for (const segment of entry.segments) {
		if (segment.kind === "text") {
			length += segment.text.length;
		}
	}
	return length;
}

function createStreamingReproViewportRow(entry: TranscriptEntry): TranscriptViewportRow {
	const activeTail =
		activeGraph.activeStreamingTail?.rowId === entry.entryId
			? activeGraph.activeStreamingTail.contentKind
			: null;
	return {
		rowId: entry.entryId,
		sourceEntryId: entry.entryId,
		kind: entry.role === "user" ? "user" : "assistantText",
		version: `${entry.entryId}:repro:${String(activeGraph.revision.transcriptRevision)}:${String(entryTextLength(entry))}`,
		anchorEligible: true,
		activeStreamingTail: activeTail,
		operationLinks: [],
		interactionLinks: [],
		content: {
			kind: "transcript",
			role: entry.role,
			segments: entry.segments,
		},
		durationStartedAtMs: null,
	};
}

function nextPhase(): void {
	if (controller.phaseIndex >= controller.activePreset.phases.length - 1) {
		controller.reset();
	} else {
		controller.nextPhase();
	}
	controllerRevision += 1;
}

function countRenderedRows(): number {
	return labElement?.querySelectorAll("[data-row-id]").length ?? 0;
}

function countAnimatedTokenSpans(): number {
	return (
		labElement?.querySelectorAll(
			'[data-sd-animate="true"], [data-acepe-token-reveal-tail="true"]'
		).length ?? 0
	);
}

function readTokenRevealMode(): string | null {
	return (
		labElement
			?.querySelector("[data-token-reveal-mode]")
			?.getAttribute("data-token-reveal-mode") ?? null
	);
}

function readDocumentHasFocus(): boolean | null {
	if (typeof document === "undefined" || typeof document.hasFocus !== "function") {
		return null;
	}
	return document.hasFocus();
}

async function measureStreamingPhaseFlush(
	phaseIndex: number,
	startedAtMs: number
): Promise<StreamingReproPerfStep> {
	await waitForDomFlush();
	const phase = controller.activePhase;
	return {
		phaseId: phase.id,
		label: phase.label,
		phaseIndex,
		assistantTextLength: phase.assistantText.length,
		turnState: phase.turnState,
		domFlushMs: readAnimationNowMs() - startedAtMs,
		rowCount: countRenderedRows(),
		animatedTokenSpans: countAnimatedTokenSpans(),
		tokenRevealMode: readTokenRevealMode(),
	};
}

async function runStreamingReproPerfProbe(): Promise<StreamingReproPerfProbeResult> {
	const totalStartedAtMs = readAnimationNowMs();
	const steps: StreamingReproPerfStep[] = [];

	controller.reset();
	for (let index = 0; index < controller.activePreset.phases.length; index += 1) {
		const phaseStartedAtMs = readAnimationNowMs();
		if (index > 0) {
			controller.nextPhase();
		}
		controllerRevision += 1;
		steps.push(await measureStreamingPhaseFlush(index, phaseStartedAtMs));
	}

	return {
		presetId: controller.activePreset.id,
		phaseCount: controller.activePreset.phases.length,
		totalMs: readAnimationNowMs() - totalStartedAtMs,
		visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
		documentHasFocus: readDocumentHasFocus(),
		steps,
	};
}

onMount(() => {
	window.__acepeStreamingReproPerfProbe = runStreamingReproPerfProbe;
	return () => {
		if (window.__acepeStreamingReproPerfProbe === runStreamingReproPerfProbe) {
			delete window.__acepeStreamingReproPerfProbe;
		}
	};
});
</script>

<div
	bind:this={labElement}
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

	<div class="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
		<AgentPanelContent
			panelId={DEFAULT_PANEL_ID}
			viewState={DEFAULT_VIEW_STATE}
			sessionId={DEFAULT_SESSION_ID}
			sceneEntries={projectedSceneEntries}
			{rowsProjectionOverride}
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
		/>
	</div>
</div>
