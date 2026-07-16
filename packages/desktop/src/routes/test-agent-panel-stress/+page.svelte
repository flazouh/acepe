<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import {
	MessageScroller,
	rowEstimatePx,
	type AgentPanelPerformanceSample,
	type MessageScrollerItem,
	type MessageScrollerItemSource,
} from "@acepe/ui/agent-panel";
import SceneContentViewport from "$lib/acp/components/agent-panel/components/scene-content-viewport.svelte";
import { deriveCanonicalAgentPanelSessionState } from "$lib/acp/components/agent-panel/logic/session-status-mapper.js";
import { hasTrailingCompletedTool } from "$lib/acp/components/agent-panel/logic/transcript-viewport-row-facts.js";
import type { LocalPlaceholderMode } from "$lib/acp/components/agent-panel/logic/local-placeholder-mode.js";
import type { TurnState } from "$lib/acp/store/types.js";
import type {
	SessionGraphLifecycle,
	TranscriptViewportRow,
	TranscriptViewportRowKind,
} from "$lib/services/acp-types.js";
import {
	AGENT_PANEL_STRESS_ROW_COUNT_PRESETS,
	createAgentPanelPlanningBetweenToolsFixtureSequence,
	createAgentPanelSendAttachFixtureSequence,
	createAgentPanelStressFixture,
	type AgentPanelSendAttachFixtureSequence,
	type AgentPanelStressFixture,
	type AgentPanelStressPreset,
} from "$lib/acp/testing/agent-panel-stress-fixture.js";
import {
	calculateAgentPanelStressFrameBudgetOverrunMs,
	classifyAgentPanelStressFrameAttribution,
	createAgentPanelStressDump,
	readAgentPanelStressMemory,
	summarizeAgentPanelStressMetrics,
	type AgentPanelStressDump,
	type AgentPanelStressFrameEnvironment,
	type AgentPanelStressFrameAttribution,
	type AgentPanelStressMetricInput,
	type AgentPanelStressPerformanceWithMemory,
	type AgentPanelStressRendererMode,
	type AgentPanelStressScrollUpdateMeasurement,
} from "$lib/acp/testing/agent-panel-stress-metrics.js";

type StressLabWindowHandle = {
	readonly route: string;
	readonly getDump: () => AgentPanelStressDump;
	readonly regenerate: () => void;
	readonly runScenario: (options: StressLabScenarioOptions) => Promise<AgentPanelStressDump>;
	readonly runScrollSample: () => Promise<AgentPanelStressDump>;
	readonly runSendAttachScenario: (
		options: SendAttachScenarioOptions
	) => Promise<SendAttachScenarioResult>;
	readonly runPlanningBetweenToolsScenario: () => Promise<PlanningBetweenToolsScenarioResult>;
};

type StressLabWindow = Window &
	typeof globalThis & {
		__agentPanelStressLab?: StressLabWindowHandle;
	};

type StressLabScenarioOptions = {
	readonly rowCount?: number;
	readonly preset?: AgentPanelStressPreset;
	readonly rendererMode?: AgentPanelStressRendererMode;
	readonly seed?: number;
	readonly includeStreamingTail?: boolean;
	readonly runScrollSample?: boolean;
};

type SendAttachScenarioOptions = {
	readonly rowCount: number;
	readonly preScrollOffsetPx: number;
};

type SendAttachScenarioSample = {
	readonly label: string;
	readonly rowCount: number;
	readonly stableRowId: string;
	readonly stableRowVersion: string | null;
	readonly stableRowContent: string | null;
	readonly stableRowShellPreserved: boolean | null;
	readonly scrollHeightPx: number;
	readonly clientHeightPx: number;
	readonly maxScrollTopPx: number;
	readonly scrollTopPx: number;
	readonly distFromBottomPx: number;
	readonly geometryReleased: boolean;
	readonly controllerReleased: boolean;
	readonly longMarkdownRowId: string;
	readonly longMarkdownHeightPx: number;
	readonly longMarkdownNative: boolean;
	readonly placeholderCount: number;
	readonly spacerCount: number;
};

type SendAttachScenarioResult = {
	readonly hookAvailable: boolean;
	readonly opened: boolean;
	readonly labPresent: boolean;
	readonly route: string;
	readonly requestedRowCount: number;
	readonly rowCount: number;
	readonly requestedPreScrollOffsetPx: number;
	readonly preconditionPassed: boolean;
	readonly passed: boolean;
	readonly maxExtentCollapsePx: number;
	readonly nativeClampDetected: boolean;
	readonly stableRowShellPreserved: boolean;
	readonly samples: readonly SendAttachScenarioSample[];
};

type PlanningBetweenToolsScenarioResult = {
	readonly hookAvailable: boolean;
	readonly opened: boolean;
	readonly labPresent: boolean;
	readonly route: string;
	readonly passed: boolean;
	readonly restoredCompletedToolStage: boolean;
	readonly samples: readonly {
		readonly stage: "completed_tool_tail" | "active_assistant_tail";
		readonly sessionId: string;
		readonly lifecycleStatus: "ready";
		readonly activityKind: "awaiting_model";
		readonly turnState: "Running";
		readonly trailingRowId: string | null;
		readonly trailingRowKind: string | null;
		readonly trailingOperationStates: readonly string[];
		readonly activeStreamingTail: string | null;
		readonly localPlaceholderMode: LocalPlaceholderMode;
		readonly planningRowCount: number;
		readonly planningText: string | null;
		readonly planningVisible: boolean;
	}[];
};

type FrameWaitSource = "raf" | "timeout";

type FrameWaitResult = {
	readonly timeMs: number;
	readonly source: FrameWaitSource;
};

type FrameRenderWaitResult = {
	readonly timeMs: number;
	readonly source: FrameWaitSource;
	readonly browserRenderMs: number;
	readonly completedAtMs: number;
};

type ScriptedScrollSample = {
	readonly frameDeltasMs: readonly number[];
	readonly frameSources: readonly FrameWaitSource[];
	readonly frameAttributions: readonly AgentPanelStressFrameAttribution[];
};

type ScrollWindowSnapshot = {
	readonly rowIds: readonly string[];
	readonly rows: readonly ScrollWindowRowSnapshot[];
	readonly firstRowIndex: number | null;
	readonly lastRowIndex: number | null;
	readonly domRowCount: number;
};

type ScrollWindowRowSnapshot = {
	readonly rowId: string;
	readonly estimateSource: "measured" | "static" | null;
	readonly staticEstimateErrorPx: number | null;
};

type ScrollWindowChurn = {
	readonly mountedRowCount: number;
	readonly unmountedRowCount: number;
};

type ScrollWindowEstimateSummary = {
	readonly staticEstimateRowCount: number;
	readonly measuredEstimateRowCount: number;
	readonly maxStaticEstimateErrorPx: number | null;
	readonly averageStaticEstimateErrorPx: number | null;
};

type ProfileDeltaSummary = {
	readonly sampleCount: number;
	readonly totalDurationMs: number;
	readonly maxDurationMs: number | null;
	readonly slowestPhase: string | null;
};

const ROUTE = "/test-agent-panel-stress";
const PANEL_ID = "agent-panel-stress-panel";
const DEFAULT_ROW_COUNT = 1_000;
const DEFAULT_PRESET: AgentPanelStressPreset = "mixed";
const DEFAULT_RENDERER_MODE: AgentPanelStressRendererMode = "full";
const DEFAULT_SEED = 1;
const DEFAULT_PANEL_WIDTH = 780;
const DEFAULT_PROJECT_PATH = "/tmp/acepe-agent-panel-stress";
const FRAME_SAMPLE_COUNT = 45;
const SCROLL_UPDATE_SAMPLE_COUNT = 24;
const MAX_PROFILE_SAMPLE_COUNT = 2_000;
const SEND_ATTACH_BOTTOM_TOLERANCE_PX = 24;
const SEND_ATTACH_MAX_EXTENT_COLLAPSE_PX = 2_200;
const SEND_ATTACH_MIN_LONG_ROW_HEIGHT_PX = 1_800;
const SEND_ATTACH_MAX_LONG_ROW_HEIGHT_PX = 2_700;
const PLANNING_ROW_SELECTOR = '[data-row-id="awaiting:planning"]';
const PLANNING_ROW_EXPECTED_TEXT = "Planning next moves";
const PLANNING_BETWEEN_TOOLS_LIFECYCLE: SessionGraphLifecycle = {
	status: "ready",
	detachedReason: null,
	failureReason: null,
	errorMessage: null,
	actionability: {
		canSend: false,
		canResume: false,
		canRetry: false,
		canArchive: true,
		canConfigure: true,
		recommendedAction: "wait",
		recoveryPhase: "none",
		compactStatus: "ready",
	},
};
const STRESS_LAB_ENABLED =
	import.meta.env.DEV || import.meta.env.VITE_ENABLE_STRESS_LAB === "1";

let selectedRowCount = $state(DEFAULT_ROW_COUNT);
let selectedPreset = $state<AgentPanelStressPreset>(DEFAULT_PRESET);
let selectedRendererMode = $state<AgentPanelStressRendererMode>(DEFAULT_RENDERER_MODE);
let seed = $state(DEFAULT_SEED);
let includeStreamingTail = $state(true);
let panelWidth = $state(DEFAULT_PANEL_WIDTH);
let transcriptHost: HTMLDivElement | null = $state(null);
let dumpTimestampIso = $state(new Date().toISOString());
let profileRevision = $state(0);
let profileSamples: AgentPanelPerformanceSample[] = [];
let renderSequence = 0;
let sendAttachPendingUserRevealRequestKey = $state<string | null>(null);
let sendAttachControllerReleased = $state(false);
let localPlaceholderMode = $state<LocalPlaceholderMode>("none");

function readNowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function readStressLabWindow(): StressLabWindow | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window as StressLabWindow;
}

function buildFixture(): {
	readonly fixture: AgentPanelStressFixture;
	readonly generationMs: number;
} {
	const startedAtMs = readNowMs();
	const fixture = createAgentPanelStressFixture({
		rowCount: selectedRowCount,
		preset: selectedPreset,
		seed,
		sessionId: "stress-agent-panel-session",
		includeStreamingTail,
	});
	return {
		fixture,
		generationMs: readNowMs() - startedAtMs,
	};
}

const initialFixtureBuild = buildFixture();
let fixture = $state.raw<AgentPanelStressFixture>(initialFixtureBuild.fixture);
let metrics = $state.raw<AgentPanelStressMetricInput>({
	generationMs: initialFixtureBuild.generationMs,
	renderSettleMs: null,
	domRowCount: 0,
	scrollToTopMs: null,
	scrollToBottomMs: null,
	scrollUpdateMeasurements: [],
	frameDeltasMs: [],
	frameAttributions: [],
	frameEnvironment: null,
	memory: null,
});

const metricSummary = $derived(summarizeAgentPanelStressMetrics(metrics));
const turnState = $derived<TurnState>(
	fixture.summary.activeTailRowId === null ? "idle" : "streaming"
);
const diagnosticScrollerItemSource = $derived(
	createDiagnosticScrollerItemSource(fixture.rowsProjection.rows)
);
const stressDump = $derived(createCurrentStressDump());
const dumpJson = $derived(JSON.stringify(stressDump, null, 2));

function recordProfileSample(sample: AgentPanelPerformanceSample): void {
	if (profileSamples.length >= MAX_PROFILE_SAMPLE_COUNT) {
		profileSamples.shift();
	}
	profileSamples.push(sample);
}

function resetProfileSamples(): void {
	profileSamples = [];
	profileRevision += 1;
}

function publishProfileSamples(): void {
	profileRevision += 1;
}

function readProfileSamplesForDump(): readonly AgentPanelPerformanceSample[] {
	if (profileRevision < 0) {
		return [];
	}
	return profileSamples;
}

function createCurrentStressDump(): AgentPanelStressDump {
	return createAgentPanelStressDump({
		route: ROUTE,
		preset: fixture.preset,
		rendererMode: selectedRendererMode,
		rowCount: fixture.summary.totalRows,
		seed: fixture.seed,
		timestampIso: dumpTimestampIso,
		metrics,
		profileSamples: readProfileSamplesForDump(),
	});
}

function createDiagnosticScrollerItem(row: TranscriptViewportRow): MessageScrollerItem {
	return {
		key: `${row.rowId}:${row.version}`,
		rowId: row.rowId,
		estimatePx: rowEstimatePx(row.kind),
		isActiveTail: row.activeStreamingTail !== null,
		anchorEligible: row.anchorEligible,
	};
}

function createDiagnosticScrollerItemSource(
	rows: readonly TranscriptViewportRow[]
): MessageScrollerItemSource {
	return {
		get length() {
			return rows.length;
		},
		getItem(index: number): MessageScrollerItem | undefined {
			const row = rows[index];
			return row === undefined ? undefined : createDiagnosticScrollerItem(row);
		},
		getItems(startIndex: number, endIndex: number): readonly MessageScrollerItem[] {
			const items: MessageScrollerItem[] = [];
			const boundedEndIndex = Math.min(endIndex, rows.length);
			for (let index = Math.max(0, startIndex); index < boundedEndIndex; index += 1) {
				const row = rows[index];
				if (row !== undefined) {
					items.push(createDiagnosticScrollerItem(row));
				}
			}
			return items;
		},
		getKey(index: number): string | null {
			const row = rows[index];
			return row === undefined ? null : `${row.rowId}:${row.version}`;
		},
		getRowId(index: number): string | null {
			return rows[index]?.rowId ?? null;
		},
		getEstimatePx(index: number): number {
			const row = rows[index];
			return row === undefined ? rowEstimatePx("assistantText") : rowEstimatePx(row.kind);
		},
		isActiveTail(index: number): boolean {
			const row = rows[index];
			return row !== undefined && row.activeStreamingTail !== null;
		},
		isAnchorEligible(index: number): boolean {
			return rows[index]?.anchorEligible ?? false;
		},
		findIndexByRowId(rowId: string): number | null {
			for (let index = 0; index < rows.length; index += 1) {
				if (rows[index]?.rowId === rowId) {
					return index;
				}
			}
			return null;
		},
	};
}

function diagnosticKindLabel(kind: TranscriptViewportRowKind): string {
	if (kind === "assistantText") {
		return "Assistant";
	}
	if (kind === "assistantThought") {
		return "Thought";
	}
	if (kind === "tool") {
		return "Tool";
	}
	return "User";
}

function diagnosticRowText(row: TranscriptViewportRow): string {
	const segment = row.content.segments[0];
	if (segment === undefined) {
		return row.rowId;
	}
	if (segment.kind === "localCommand") {
		return segment.message;
	}
	return segment.text;
}

function isStressPreset(
	value: AgentPanelStressPreset | undefined
): value is AgentPanelStressPreset {
	return (
		value === "mixed" ||
		value === "text-heavy" ||
		value === "tool-heavy" ||
		value === "streaming-tail"
	);
}

function isStressRendererMode(
	value: AgentPanelStressRendererMode | undefined
): value is AgentPanelStressRendererMode {
	return value === "full" || value === "text-only" || value === "shell-only";
}

function readCurrentMemory() {
	if (typeof performance === "undefined") {
		return null;
	}
	return readAgentPanelStressMemory(performance as AgentPanelStressPerformanceWithMemory);
}

function countDomRows(): number {
	if (transcriptHost === null) {
		return 0;
	}
	return transcriptHost.querySelectorAll("[data-row-id]").length;
}

function readRowIndex(element: Element | null): number | null {
	if (element === null) {
		return null;
	}
	const rawIndex = element.getAttribute("data-row-index");
	if (rawIndex === null) {
		return null;
	}
	const parsedIndex = Number(rawIndex);
	if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
		return null;
	}
	return parsedIndex;
}

function readNumberAttribute(element: Element, attributeName: string): number | null {
	const rawValue = element.getAttribute(attributeName);
	if (rawValue === null) {
		return null;
	}
	const parsedValue = Number(rawValue);
	return Number.isFinite(parsedValue) ? parsedValue : null;
}

function readEstimateSource(element: Element): "measured" | "static" | null {
	const source = element.getAttribute("data-cv-estimate-source");
	if (source === "measured" || source === "static") {
		return source;
	}
	return null;
}

function readScrollWindowSnapshot(): ScrollWindowSnapshot {
	if (transcriptHost === null) {
		return {
			rowIds: [],
			rows: [],
			firstRowIndex: null,
			lastRowIndex: null,
			domRowCount: 0,
		};
	}
	const rowElements = Array.from(transcriptHost.querySelectorAll("[data-row-id]"));
	const rowIds: string[] = [];
	const rows: ScrollWindowRowSnapshot[] = [];
	for (const rowElement of rowElements) {
		const rowId = rowElement.getAttribute("data-row-id");
		if (rowId !== null) {
			rowIds.push(rowId);
			rows.push({
				rowId,
				estimateSource: readEstimateSource(rowElement),
				staticEstimateErrorPx: readNumberAttribute(rowElement, "data-static-estimate-error-px"),
			});
		}
	}
	return {
		rowIds,
		rows,
		firstRowIndex: readRowIndex(rowElements[0] ?? null),
		lastRowIndex: readRowIndex(rowElements.at(-1) ?? null),
		domRowCount: rowElements.length,
	};
}

function countScrollWindowChurn(
	before: ScrollWindowSnapshot,
	after: ScrollWindowSnapshot
): ScrollWindowChurn {
	const beforeRowIds = new Set(before.rowIds);
	const afterRowIds = new Set(after.rowIds);
	let mountedRowCount = 0;
	let unmountedRowCount = 0;
	for (const rowId of afterRowIds) {
		if (!beforeRowIds.has(rowId)) {
			mountedRowCount += 1;
		}
	}
	for (const rowId of beforeRowIds) {
		if (!afterRowIds.has(rowId)) {
			unmountedRowCount += 1;
		}
	}
	return {
		mountedRowCount,
		unmountedRowCount,
	};
}

function summarizeScrollWindowEstimates(
	snapshot: ScrollWindowSnapshot
): ScrollWindowEstimateSummary {
	let staticEstimateRowCount = 0;
	let measuredEstimateRowCount = 0;
	let errorTotalPx = 0;
	let errorCount = 0;
	let maxStaticEstimateErrorPx: number | null = null;
	for (const row of snapshot.rows) {
		if (row.estimateSource === "measured") {
			measuredEstimateRowCount += 1;
		}
		if (row.estimateSource === "static") {
			staticEstimateRowCount += 1;
		}
		if (row.staticEstimateErrorPx !== null) {
			errorTotalPx += row.staticEstimateErrorPx;
			errorCount += 1;
			if (
				maxStaticEstimateErrorPx === null ||
				row.staticEstimateErrorPx > maxStaticEstimateErrorPx
			) {
				maxStaticEstimateErrorPx = row.staticEstimateErrorPx;
			}
		}
	}
	return {
		staticEstimateRowCount,
		measuredEstimateRowCount,
		maxStaticEstimateErrorPx,
		averageStaticEstimateErrorPx: errorCount === 0 ? null : errorTotalPx / errorCount,
	};
}

function countColdRevealedRows(before: ScrollWindowSnapshot, after: ScrollWindowSnapshot): number {
	const beforeRowIds = new Set(before.rowIds);
	let count = 0;
	for (const row of after.rows) {
		if (!beforeRowIds.has(row.rowId) && row.estimateSource !== "measured") {
			count += 1;
		}
	}
	return count;
}

function summarizeProfileDelta(startIndex: number): ProfileDeltaSummary {
	let totalDurationMs = 0;
	let sampleCount = 0;
	let maxDurationMs: number | null = null;
	let slowestPhase: string | null = null;
	for (let index = startIndex; index < profileSamples.length; index += 1) {
		const sample = profileSamples[index];
		if (sample === undefined) {
			continue;
		}
		const durationMs = Number.isFinite(sample.durationMs) ? sample.durationMs : 0;
		totalDurationMs += durationMs;
		sampleCount += 1;
		if (maxDurationMs === null || durationMs > maxDurationMs) {
			maxDurationMs = durationMs;
			slowestPhase = sample.phase;
		}
	}
	return {
		sampleCount,
		totalDurationMs,
		maxDurationMs,
		slowestPhase,
	};
}

function waitForNextFrame(): Promise<FrameWaitResult> {
	return new Promise((resolve) => {
		let resolved = false;
		const finish = (timeMs: number, source: FrameWaitSource): void => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolve({
				timeMs,
				source,
			});
		};
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame((timeMs) => {
				finish(timeMs, "raf");
			});
		}
		setTimeout(() => {
			finish(readNowMs(), "timeout");
		}, 50);
	});
}

function waitForNextFrameAfterRender(): Promise<FrameRenderWaitResult> {
	return new Promise((resolve) => {
		let resolved = false;
		const finish = (
			timeMs: number,
			source: FrameWaitSource,
			frameCallbackCompletedAtMs: number
		): void => {
			if (resolved) {
				return;
			}
			const finishAfterRender = (): void => {
				if (resolved) {
					return;
				}
				const completedAtMs = readNowMs();
				resolved = true;
				resolve({
					timeMs,
					source,
					browserRenderMs: Math.max(0, completedAtMs - frameCallbackCompletedAtMs),
					completedAtMs,
				});
			};
			if (source === "raf" && typeof MessageChannel === "function") {
				const channel = new MessageChannel();
				channel.port1.onmessage = () => {
					channel.port1.close();
					channel.port2.close();
					finishAfterRender();
				};
				channel.port2.postMessage(0);
				return;
			}
			setTimeout(finishAfterRender, 0);
		};
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame((timeMs) => {
				finish(timeMs, "raf", readNowMs());
			});
		}
		setTimeout(() => {
			finish(readNowMs(), "timeout", readNowMs());
		}, 50);
	});
}

async function waitForDomFlush(): Promise<void> {
	await tick();
	await Promise.resolve();
}

function frameSamplingWouldBeThrottled(): boolean {
	if (typeof document === "undefined") {
		return false;
	}
	if (document.visibilityState !== "visible") {
		return true;
	}
	if (typeof document.hasFocus === "function" && !document.hasFocus()) {
		return true;
	}
	return false;
}

async function sampleRenderFrameSources(): Promise<readonly FrameWaitSource[]> {
	if (frameSamplingWouldBeThrottled()) {
		return [];
	}
	const firstFrame = await waitForNextFrame();
	const secondFrame = await waitForNextFrame();
	const thirdFrame = await waitForNextFrame();
	return [firstFrame.source, secondFrame.source, thirdFrame.source];
}

function longAnimationFrameObserverAvailable(): boolean {
	if (typeof PerformanceObserver !== "function") {
		return false;
	}
	const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
	return supportedEntryTypes.includes("long-animation-frame");
}

function readFrameEnvironment(
	frameSources: readonly FrameWaitSource[]
): AgentPanelStressFrameEnvironment {
	let rafWaitCount = 0;
	let timeoutWaitCount = 0;
	for (const frameSource of frameSources) {
		if (frameSource === "raf") {
			rafWaitCount += 1;
			continue;
		}
		timeoutWaitCount += 1;
	}

	return {
		visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
		documentHasFocus:
			typeof document !== "undefined" && typeof document.hasFocus === "function"
				? document.hasFocus()
				: null,
		requestAnimationFrameAvailable: typeof requestAnimationFrame === "function",
		longAnimationFrameObserverAvailable: longAnimationFrameObserverAvailable(),
		rafWaitCount,
		timeoutWaitCount,
	};
}

async function settleRenderMetrics(
	renderStartedAtMs: number,
	sequence: number
): Promise<AgentPanelStressDump> {
	await waitForDomFlush();
	const renderSettleMs = readNowMs() - renderStartedAtMs;
	const domRowCount = countDomRows();
	const memory = readCurrentMemory();
	const frameSources = await sampleRenderFrameSources();
	if (sequence !== renderSequence) {
		return createCurrentStressDump();
	}
	metrics = {
		generationMs: metrics.generationMs,
		renderSettleMs,
		domRowCount,
		scrollToTopMs: metrics.scrollToTopMs,
		scrollToBottomMs: metrics.scrollToBottomMs,
		scrollUpdateMeasurements: metrics.scrollUpdateMeasurements,
		frameDeltasMs: metrics.frameDeltasMs,
		frameAttributions: metrics.frameAttributions,
		frameEnvironment: readFrameEnvironment(frameSources),
		memory,
	};
	dumpTimestampIso = new Date().toISOString();
	publishProfileSamples();
	return createCurrentStressDump();
}

function resolveScrollViewport(): HTMLElement | null {
	if (transcriptHost === null) {
		return null;
	}
	return transcriptHost.querySelector<HTMLElement>('[role="log"]');
}

async function sampleScriptedScroll(
	viewport: HTMLElement,
	frameCount: number
): Promise<ScriptedScrollSample> {
	const samples: number[] = [];
	const frameSources: FrameWaitSource[] = [];
	const frameAttributions: AgentPanelStressFrameAttribution[] = [];
	const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	let previousFrameMs = await waitForNextFrameAfterRender();
	let previousWindow = readScrollWindowSnapshot();
	frameSources.push(previousFrameMs.source);
	for (let index = 0; index < frameCount; index += 1) {
		const progress = (index + 1) / frameCount;
		const targetScrollTopPx = maxScrollTop * progress;
		const profileStartIndex = profileSamples.length;
		const scrollSetStartedAtMs = readNowMs();
		viewport.scrollTop = targetScrollTopPx;
		viewport.dispatchEvent(new Event("scroll"));
		const scrollSetMs = readNowMs() - scrollSetStartedAtMs;
		const currentFrameMs = await waitForNextFrameAfterRender();
		frameSources.push(currentFrameMs.source);
		const frameDeltaMs = currentFrameMs.timeMs - previousFrameMs.timeMs;
		const previousBrowserRenderMs = previousFrameMs.browserRenderMs;
		const preFrameGapMs = Math.max(0, currentFrameMs.timeMs - previousFrameMs.completedAtMs);
		samples.push(frameDeltaMs);
		const inspectionStartedAtMs = readNowMs();
		const nextWindow = readScrollWindowSnapshot();
		const churn = countScrollWindowChurn(previousWindow, nextWindow);
		const coldRevealedRowCount = countColdRevealedRows(previousWindow, nextWindow);
		const estimateSummary = summarizeScrollWindowEstimates(nextWindow);
		const profileDelta = summarizeProfileDelta(profileStartIndex);
		const afterFrameInspectionMs = readNowMs() - inspectionStartedAtMs;
		frameAttributions.push({
			frameIndex: index,
			targetScrollTopPx,
			frameDeltaMs,
			frameBudgetOverrunMs: calculateAgentPanelStressFrameBudgetOverrunMs(frameDeltaMs),
			scrollSetMs,
			afterFrameInspectionMs,
			browserRenderMs: currentFrameMs.browserRenderMs,
			previousBrowserRenderMs,
			preFrameGapMs,
			domRowCount: nextWindow.domRowCount,
			firstRowIndex: nextWindow.firstRowIndex,
			lastRowIndex: nextWindow.lastRowIndex,
			mountedRowCount: churn.mountedRowCount,
			unmountedRowCount: churn.unmountedRowCount,
			coldRevealedRowCount,
			staticEstimateRowCount: estimateSummary.staticEstimateRowCount,
			measuredEstimateRowCount: estimateSummary.measuredEstimateRowCount,
			maxStaticEstimateErrorPx: estimateSummary.maxStaticEstimateErrorPx,
			averageStaticEstimateErrorPx: estimateSummary.averageStaticEstimateErrorPx,
			profileSampleCount: profileDelta.sampleCount,
			profileDurationMs: profileDelta.totalDurationMs,
			profileMaxDurationMs: profileDelta.maxDurationMs,
			profileSlowestPhase: profileDelta.slowestPhase,
			cause: classifyAgentPanelStressFrameAttribution({
				frameDeltaMs,
				scrollSetMs,
				afterFrameInspectionMs,
				browserRenderMs: currentFrameMs.browserRenderMs,
				previousBrowserRenderMs,
				preFrameGapMs,
				domRowCount: nextWindow.domRowCount,
				mountedRowCount: churn.mountedRowCount,
				unmountedRowCount: churn.unmountedRowCount,
				coldRevealedRowCount,
				staticEstimateRowCount: estimateSummary.staticEstimateRowCount,
				measuredEstimateRowCount: estimateSummary.measuredEstimateRowCount,
				maxStaticEstimateErrorPx: estimateSummary.maxStaticEstimateErrorPx,
				averageStaticEstimateErrorPx: estimateSummary.averageStaticEstimateErrorPx,
				profileDurationMs: profileDelta.totalDurationMs,
			}),
		});
		previousWindow = nextWindow;
		previousFrameMs = currentFrameMs;
	}
	return {
		frameDeltasMs: samples,
		frameSources,
		frameAttributions,
	};
}

async function sampleScrollUpdates(
	viewport: HTMLElement,
	stepCount: number
): Promise<readonly AgentPanelStressScrollUpdateMeasurement[]> {
	const measurements: AgentPanelStressScrollUpdateMeasurement[] = [];
	const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	let previousWindow = readScrollWindowSnapshot();
	for (let index = 0; index < stepCount; index += 1) {
		const progress = stepCount <= 1 ? 1 : index / (stepCount - 1);
		const targetScrollTopPx = maxScrollTop * progress;
		const profileStartIndex = profileSamples.length;
		const startedAtMs = readNowMs();
		viewport.scrollTop = targetScrollTopPx;
		viewport.dispatchEvent(new Event("scroll"));
		await waitForDomFlush();
		const nextWindow = readScrollWindowSnapshot();
		const churn = countScrollWindowChurn(previousWindow, nextWindow);
		const profileDelta = summarizeProfileDelta(profileStartIndex);
		measurements.push({
			scrollTopPx: viewport.scrollTop,
			updateMs: readNowMs() - startedAtMs,
			domRowCount: nextWindow.domRowCount,
			firstRowIndex: nextWindow.firstRowIndex,
			lastRowIndex: nextWindow.lastRowIndex,
			mountedRowCount: churn.mountedRowCount,
			unmountedRowCount: churn.unmountedRowCount,
			profileSampleCount: profileDelta.sampleCount,
			profileDurationMs: profileDelta.totalDurationMs,
			profileMaxDurationMs: profileDelta.maxDurationMs,
			profileSlowestPhase: profileDelta.slowestPhase,
		});
		previousWindow = nextWindow;
	}
	return measurements;
}

async function runScrollSample(): Promise<AgentPanelStressDump> {
	const viewport = resolveScrollViewport();
	if (viewport === null) {
		return createCurrentStressDump();
	}

	resetProfileSamples();
	const scrollUpdateMeasurements = await sampleScrollUpdates(viewport, SCROLL_UPDATE_SAMPLE_COUNT);

	if (frameSamplingWouldBeThrottled()) {
		viewport.scrollTop = 0;
		viewport.dispatchEvent(new Event("scroll"));
		await waitForDomFlush();
		metrics = {
			generationMs: metrics.generationMs,
			renderSettleMs: metrics.renderSettleMs,
			domRowCount: countDomRows(),
			scrollToTopMs: null,
			scrollToBottomMs: null,
			scrollUpdateMeasurements,
			frameDeltasMs: [],
			frameAttributions: [],
			frameEnvironment: readFrameEnvironment([]),
			memory: readCurrentMemory(),
		};
		dumpTimestampIso = new Date().toISOString();
		publishProfileSamples();
		return createCurrentStressDump();
	}

	const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	const frameSources: FrameWaitSource[] = [];
	const scrollToBottomStartedAtMs = readNowMs();
	viewport.scrollTop = maxScrollTop;
	const bottomFrame = await waitForNextFrame();
	frameSources.push(bottomFrame.source);
	const scrollToBottomMs = readNowMs() - scrollToBottomStartedAtMs;

	viewport.scrollTop = 0;
	const resetFrame = await waitForNextFrame();
	frameSources.push(resetFrame.source);
	const scriptedScrollSample = await sampleScriptedScroll(viewport, FRAME_SAMPLE_COUNT);
	for (const frameSource of scriptedScrollSample.frameSources) {
		frameSources.push(frameSource);
	}

	const scrollToTopStartedAtMs = readNowMs();
	viewport.scrollTop = 0;
	const topFrame = await waitForNextFrame();
	frameSources.push(topFrame.source);
	const scrollToTopMs = readNowMs() - scrollToTopStartedAtMs;

	metrics = {
		generationMs: metrics.generationMs,
		renderSettleMs: metrics.renderSettleMs,
		domRowCount: countDomRows(),
		scrollToTopMs,
		scrollToBottomMs,
		scrollUpdateMeasurements,
		frameDeltasMs: scriptedScrollSample.frameDeltasMs,
		frameAttributions: scriptedScrollSample.frameAttributions,
		frameEnvironment: readFrameEnvironment(frameSources),
		memory: readCurrentMemory(),
	};
	dumpTimestampIso = new Date().toISOString();
	publishProfileSamples();
	return createCurrentStressDump();
}

async function regenerateFixtureAndMeasure(): Promise<AgentPanelStressDump> {
	resetProfileSamples();
	renderSequence += 1;
	const sequence = renderSequence;
	const built = buildFixture();
	const renderStartedAtMs = readNowMs();
	fixture = built.fixture;
	metrics = {
		generationMs: built.generationMs,
		renderSettleMs: null,
		domRowCount: 0,
		scrollToTopMs: null,
		scrollToBottomMs: null,
		scrollUpdateMeasurements: [],
		frameDeltasMs: [],
		frameAttributions: [],
		frameEnvironment: null,
		memory: null,
	};
	dumpTimestampIso = new Date().toISOString();
	return settleRenderMetrics(renderStartedAtMs, sequence);
}

function regenerateFixture(): void {
	localPlaceholderMode = "none";
	void regenerateFixtureAndMeasure();
}

async function runScenario(options: StressLabScenarioOptions): Promise<AgentPanelStressDump> {
	localPlaceholderMode = "none";
	if (options.rowCount !== undefined && Number.isFinite(options.rowCount)) {
		selectedRowCount = Math.max(0, Math.floor(options.rowCount));
	}
	if (isStressPreset(options.preset)) {
		selectedPreset = options.preset;
	}
	if (isStressRendererMode(options.rendererMode)) {
		selectedRendererMode = options.rendererMode;
	}
	if (options.seed !== undefined && Number.isFinite(options.seed)) {
		seed = Math.max(0, Math.floor(options.seed));
	}
	if (options.includeStreamingTail !== undefined) {
		includeStreamingTail = options.includeStreamingTail;
	}

	const renderedDump = await regenerateFixtureAndMeasure();
	if (options.runScrollSample === true) {
		return runScrollSample();
	}
	return renderedDump;
}

function sendAttachRowElement(rowId: string): HTMLElement | null {
	if (transcriptHost === null) {
		return null;
	}
	return transcriptHost.querySelector<HTMLElement>(
		`[data-row-id="${CSS.escape(rowId)}"]`
	);
}

async function settleSendAttachStage(): Promise<void> {
	await waitForDomFlush();
	await waitForNextFrame();
	await waitForNextFrame();
	await waitForDomFlush();
}

function derivePlanningBetweenToolsMode(
	targetFixture: AgentPanelStressFixture
): LocalPlaceholderMode {
	return deriveCanonicalAgentPanelSessionState({
		source: {
			kind: "canonical",
			lifecycle: PLANNING_BETWEEN_TOOLS_LIFECYCLE,
			activity: {
				kind: "awaiting_model",
				activeOperationCount: 0,
				activeSubagentCount: 0,
				dominantOperationId: null,
				blockingInteractionId: null,
			},
			turnState: "Running",
		},
		hasEntries: targetFixture.rowsProjection.rows.length > 0,
		hasTrailingCompletedTool: hasTrailingCompletedTool(
			targetFixture.rowsProjection.rows
		),
	}).localPlaceholderMode;
}

async function applyPlanningBetweenToolsStage(
	targetFixture: AgentPanelStressFixture
): Promise<void> {
	selectedRowCount = targetFixture.rowsProjection.rows.length;
	selectedPreset = targetFixture.preset;
	selectedRendererMode = "full";
	seed = targetFixture.seed;
	includeStreamingTail = targetFixture.summary.activeTailRowId !== null;
	fixture = targetFixture;
	localPlaceholderMode = derivePlanningBetweenToolsMode(targetFixture);
	await settleSendAttachStage();
}

function planningRowIsVisible(row: HTMLElement): boolean {
	const style = getComputedStyle(row);
	const rect = row.getBoundingClientRect();
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		Number(style.opacity) > 0 &&
		rect.width > 0 &&
		rect.height > 0
	);
}

function samplePlanningBetweenToolsStage(
	stage: "completed_tool_tail" | "active_assistant_tail"
): PlanningBetweenToolsScenarioResult["samples"][number] {
	const trailingRow = fixture.rowsProjection.rows.at(-1);
	const planningRows =
		transcriptHost === null
			? []
			: Array.from(transcriptHost.querySelectorAll<HTMLElement>(PLANNING_ROW_SELECTOR));
	const planningRow = planningRows[0];
	const planningText =
		planningRow === undefined
			? null
			: (planningRow.textContent || "").trim().replace(/\s+/g, " ");
	return {
		stage,
		sessionId: fixture.sessionId,
		lifecycleStatus: "ready",
		activityKind: "awaiting_model",
		turnState: "Running",
		trailingRowId: trailingRow === undefined ? null : trailingRow.rowId,
		trailingRowKind: trailingRow === undefined ? null : trailingRow.kind,
		trailingOperationStates:
			trailingRow === undefined
				? []
				: trailingRow.operationLinks.map((operationLink) => operationLink.state),
		activeStreamingTail:
			trailingRow === undefined ? null : trailingRow.activeStreamingTail,
		localPlaceholderMode,
		planningRowCount: planningRows.length,
		planningText,
		planningVisible: planningRows.some(planningRowIsVisible),
	};
}

function completedToolPlanningSamplePassed(
	sample: PlanningBetweenToolsScenarioResult["samples"][number]
): boolean {
	return (
		sample.trailingRowKind === "tool" &&
		sample.trailingOperationStates.length > 0 &&
		sample.trailingOperationStates.every((state) => state === "completed") &&
		sample.localPlaceholderMode === "planning_after_tool" &&
		sample.planningRowCount === 1 &&
		sample.planningVisible &&
		sample.planningText?.includes(PLANNING_ROW_EXPECTED_TEXT) === true
	);
}

function activeAssistantPlanningSamplePassed(
	sample: PlanningBetweenToolsScenarioResult["samples"][number]
): boolean {
	return (
		sample.trailingRowKind === "assistantText" &&
		sample.activeStreamingTail === "message" &&
		sample.localPlaceholderMode === "none" &&
		sample.planningRowCount === 0 &&
		!sample.planningVisible
	);
}

export async function runPlanningBetweenToolsScenario(): Promise<PlanningBetweenToolsScenarioResult> {
	const sequence = createAgentPanelPlanningBetweenToolsFixtureSequence();
	await applyPlanningBetweenToolsStage(sequence.completedToolTail);
	const completedToolSample = samplePlanningBetweenToolsStage("completed_tool_tail");

	await applyPlanningBetweenToolsStage(sequence.activeAssistantTail);
	const activeAssistantSample = samplePlanningBetweenToolsStage("active_assistant_tail");

	await applyPlanningBetweenToolsStage(sequence.completedToolTail);
	const restoredCompletedToolSample = samplePlanningBetweenToolsStage("completed_tool_tail");
	const restoredCompletedToolStage = completedToolPlanningSamplePassed(
		restoredCompletedToolSample
	);
	return {
		hookAvailable: true,
		opened: typeof window !== "undefined" && window.location.pathname === ROUTE,
		labPresent: transcriptHost !== null,
		route: ROUTE,
		passed:
			completedToolPlanningSamplePassed(completedToolSample) &&
			activeAssistantPlanningSamplePassed(activeAssistantSample) &&
			restoredCompletedToolStage,
		restoredCompletedToolStage,
		samples: [completedToolSample, activeAssistantSample],
	};
}

async function sampleSendAttachStage(input: {
	readonly label: string;
	readonly sequence: AgentPanelSendAttachFixtureSequence;
	readonly stableRowShell: Element | null;
}): Promise<SendAttachScenarioSample> {
	await settleSendAttachStage();
	const viewport = resolveScrollViewport();
	const scrollHeightPx = viewport === null ? 0 : Math.round(viewport.scrollHeight);
	const clientHeightPx = viewport === null ? 0 : Math.round(viewport.clientHeight);
	const maxScrollTopPx = Math.max(0, scrollHeightPx - clientHeightPx);
	const scrollTopPx = viewport === null ? 0 : Math.round(viewport.scrollTop);
	const distFromBottomPx = Math.max(0, maxScrollTopPx - scrollTopPx);
	const longRow = sendAttachRowElement(input.sequence.longMarkdownRowId);
	const stableRow = sendAttachRowElement(input.sequence.streamingRowId);
	const stableRowProjection = fixture.rowsProjection.byId.get(input.sequence.streamingRowId);
	const stableRowContent =
		stableRow === null
			? null
			: (stableRow.textContent || "").trim().replace(/\s+/g, " ");
	return {
		label: input.label,
		rowCount: fixture.rowsProjection.rows.length,
		stableRowId: input.sequence.streamingRowId,
		stableRowVersion:
			stableRowProjection === undefined ? null : stableRowProjection.version,
		stableRowContent,
		stableRowShellPreserved:
			input.stableRowShell === null || stableRow === null
				? null
				: stableRow.parentElement === input.stableRowShell,
		scrollHeightPx,
		clientHeightPx,
		maxScrollTopPx,
		scrollTopPx,
		distFromBottomPx,
		geometryReleased: distFromBottomPx > SEND_ATTACH_BOTTOM_TOLERANCE_PX,
		controllerReleased: sendAttachControllerReleased,
		longMarkdownRowId: input.sequence.longMarkdownRowId,
		longMarkdownHeightPx:
			longRow === null ? 0 : Math.round(longRow.getBoundingClientRect().height),
		longMarkdownNative:
			longRow !== null && longRow.querySelector("[data-native-markdown-mode]") !== null,
		placeholderCount:
			transcriptHost === null
				? 0
				: transcriptHost.querySelectorAll(
						'[data-row-id="awaiting:planning"], [data-row-id="local:planning"]'
					).length,
		spacerCount:
			transcriptHost === null
				? 0
				: transcriptHost.querySelectorAll(
						".message-scroller__send-anchor-spacer, [data-send-anchor-spacer]"
					).length,
	};
}

function maximumSendAttachExtentCollapse(
	samples: readonly SendAttachScenarioSample[]
): number {
	let maxCollapsePx = 0;
	for (let index = 1; index < samples.length; index += 1) {
		const previous = samples[index - 1];
		const current = samples[index];
		if (previous === undefined || current === undefined) {
			continue;
		}
		maxCollapsePx = Math.max(
			maxCollapsePx,
			previous.maxScrollTopPx - current.maxScrollTopPx
		);
	}
	return maxCollapsePx;
}

export async function runSendAttachScenario(
	options: SendAttachScenarioOptions
): Promise<SendAttachScenarioResult> {
	localPlaceholderMode = "none";
	const sequence = createAgentPanelSendAttachFixtureSequence({
		rowCount: options.rowCount,
	});
	selectedRowCount = sequence.initial.rowsProjection.rows.length;
	selectedPreset = "text-heavy";
	selectedRendererMode = "full";
	includeStreamingTail = false;
	sendAttachPendingUserRevealRequestKey = null;
	sendAttachControllerReleased = false;
	fixture = sequence.initial;
	await settleSendAttachStage();

	const viewport = resolveScrollViewport();
	if (viewport !== null) {
		viewport.dispatchEvent(
			new WheelEvent("wheel", {
				bubbles: true,
				cancelable: true,
				deltaY: -Math.max(1, options.preScrollOffsetPx),
			})
		);
		const maxScrollTopPx = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
		viewport.scrollTop = Math.max(0, maxScrollTopPx - options.preScrollOffsetPx);
		viewport.dispatchEvent(new Event("scroll"));
	}

	const samples: SendAttachScenarioSample[] = [];
	const preSendSample = await sampleSendAttachStage({
		label: "pre-send",
		sequence,
		stableRowShell: null,
	});
	samples.push(preSendSample);
	const preconditionPassed =
		Math.abs(preSendSample.distFromBottomPx - options.preScrollOffsetPx) <=
			SEND_ATTACH_BOTTOM_TOLERANCE_PX &&
		preSendSample.controllerReleased;

	sendAttachPendingUserRevealRequestKey =
		`send-attach:${Date.now().toString()}:${renderSequence.toString()}`;
	samples.push(
		await sampleSendAttachStage({
			label: "after-send",
			sequence,
			stableRowShell: null,
		})
	);

	fixture = sequence.pendingUser;
	samples.push(
		await sampleSendAttachStage({
			label: "after-pending-user",
			sequence,
			stableRowShell: null,
		})
	);

	fixture = sequence.firstStream;
	samples.push(
		await sampleSendAttachStage({
			label: "after-first-stream",
			sequence,
			stableRowShell: null,
		})
	);
	const stableRowBeforeUpdate = sendAttachRowElement(sequence.streamingRowId);
	const stableRowShell =
		stableRowBeforeUpdate === null ? null : stableRowBeforeUpdate.parentElement;

	fixture = sequence.updatedStream;
	const updatedSample = await sampleSendAttachStage({
		label: "after-version-update",
		sequence,
		stableRowShell,
	});
	samples.push(updatedSample);
	const finalSample = await sampleSendAttachStage({
		label: "final",
		sequence,
		stableRowShell,
	});
	samples.push(finalSample);

	const maxExtentCollapsePx = maximumSendAttachExtentCollapse(samples);
	let nativeClampDetected = false;
	let zeroSyntheticRows = true;
	let longMarkdownValid = true;
	for (let index = 0; index < samples.length; index += 1) {
		const sample = samples[index];
		if (sample === undefined) {
			continue;
		}
		if (index > 0 && (sample.geometryReleased || sample.controllerReleased)) {
			nativeClampDetected = true;
		}
		if (sample.placeholderCount !== 0 || sample.spacerCount !== 0) {
			zeroSyntheticRows = false;
		}
		if (
			!sample.longMarkdownNative ||
			sample.longMarkdownHeightPx < SEND_ATTACH_MIN_LONG_ROW_HEIGHT_PX ||
			sample.longMarkdownHeightPx > SEND_ATTACH_MAX_LONG_ROW_HEIGHT_PX
		) {
			longMarkdownValid = false;
		}
	}
	const stableRowShellPreserved =
		updatedSample.stableRowShellPreserved === true &&
		finalSample.stableRowShellPreserved === true &&
		finalSample.stableRowVersion === `${sequence.streamingRowId}:v2` &&
		(finalSample.stableRowContent || "").includes("send-attach-stream-version-two");
	const passed =
		preconditionPassed &&
		!nativeClampDetected &&
		maxExtentCollapsePx < SEND_ATTACH_MAX_EXTENT_COLLAPSE_PX &&
		stableRowShellPreserved &&
		zeroSyntheticRows &&
		longMarkdownValid;
	return {
		hookAvailable: true,
		opened: typeof window !== "undefined" && window.location.pathname === ROUTE,
		labPresent: transcriptHost !== null,
		route: ROUTE,
		requestedRowCount: options.rowCount,
		rowCount: fixture.rowsProjection.rows.length,
		requestedPreScrollOffsetPx: options.preScrollOffsetPx,
		preconditionPassed,
		passed,
		maxExtentCollapsePx,
		nativeClampDetected,
		stableRowShellPreserved,
		samples,
	};
}

function handleRowCountChange(event: Event): void {
	const select = event.currentTarget as HTMLSelectElement;
	selectedRowCount = Number(select.value);
	regenerateFixture();
}

function handlePresetChange(event: Event): void {
	const select = event.currentTarget as HTMLSelectElement;
	selectedPreset = select.value as AgentPanelStressPreset;
	regenerateFixture();
}

function handleRendererModeChange(event: Event): void {
	const select = event.currentTarget as HTMLSelectElement;
	const nextRendererMode = select.value as AgentPanelStressRendererMode;
	if (isStressRendererMode(nextRendererMode)) {
		selectedRendererMode = nextRendererMode;
		regenerateFixture();
	}
}

function handleSeedInput(event: Event): void {
	const input = event.currentTarget as HTMLInputElement;
	seed = Number(input.value);
}

function handlePanelWidthInput(event: Event): void {
	const input = event.currentTarget as HTMLInputElement;
	panelWidth = Number(input.value);
}

function handleStreamingTailChange(event: Event): void {
	const input = event.currentTarget as HTMLInputElement;
	includeStreamingTail = input.checked;
	regenerateFixture();
}

function downloadDump(): void {
	const blob = new Blob([dumpJson], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `agent-panel-stress-${fixture.summary.totalRows}-${fixture.preset}-${selectedRendererMode}.json`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

function handleSendAttachFollowStateChange(state: {
	readonly released: boolean;
	readonly hasUnreadBelow: boolean;
}): void {
	sendAttachControllerReleased = state.released;
}

function publishWindowHandle(): void {
	const stressWindow = readStressLabWindow();
	if (stressWindow === null) {
		return;
	}
		stressWindow.__agentPanelStressLab = {
			route: ROUTE,
			getDump: () => stressDump,
			regenerate: regenerateFixture,
			runScenario,
			runScrollSample,
			runSendAttachScenario,
			runPlanningBetweenToolsScenario,
		};
}

onMount(() => {
	publishWindowHandle();
	renderSequence += 1;
	void settleRenderMetrics(readNowMs(), renderSequence);
});

onDestroy(() => {
	const stressWindow = readStressLabWindow();
	if (stressWindow === null) {
		return;
	}
	if (stressWindow.__agentPanelStressLab?.route === ROUTE) {
		delete stressWindow.__agentPanelStressLab;
	}
});
</script>

{#snippet renderDiagnosticItem(item: MessageScrollerItem)}
	{@const row = fixture.rowsProjection.byId.get(item.rowId)}
	{#if selectedRendererMode === "shell-only"}
		<div
			class="stress-diagnostic-row stress-diagnostic-row--shell"
			style:height={`${item.estimatePx}px`}
			data-testid="stress-diagnostic-shell-row"
			aria-hidden="true"
		></div>
	{:else}
		<div
			class={["stress-diagnostic-row", row && `stress-diagnostic-row--${row.kind}`]}
			style:min-height={`${item.estimatePx}px`}
			data-testid="stress-diagnostic-text-row"
		>
			<div class="stress-diagnostic-row__label">
				{row === undefined ? "Row" : diagnosticKindLabel(row.kind)}
			</div>
			<div class="stress-diagnostic-row__text">
				{row === undefined ? item.rowId : diagnosticRowText(row)}
			</div>
		</div>
	{/if}
{/snippet}

{#if !STRESS_LAB_ENABLED}
	<div class="grid h-screen w-screen place-items-center bg-background text-sm text-muted-foreground">
		<div data-testid="agent-panel-stress-lab-unavailable">Stress lab unavailable in this build.</div>
	</div>
{:else}
	<div
		class="flex h-screen w-screen min-w-0 flex-col overflow-hidden bg-background text-foreground"
		data-testid="agent-panel-stress-lab"
	>
		<header class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="min-w-0">
				<h1 class="text-sm font-semibold">Agent Panel Stress Lab</h1>
				<div class="text-xs text-muted-foreground">
					{fixture.summary.totalRows.toLocaleString()} rows · {fixture.preset} · {selectedRendererMode} · DOM {metricSummary.domRowCount.toLocaleString()}
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
					onclick={() => {
						void runScrollSample();
					}}
					data-testid="stress-scroll-sample-button"
				>
					Run Scroll Sample
				</button>
				<button
					type="button"
					class="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
					onclick={downloadDump}
					data-testid="stress-download-dump-button"
				>
					Download JSON
				</button>
			</div>
		</header>

		<main class="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden">
			<aside class="min-h-0 overflow-y-auto border-r border-border p-4">
				<div class="space-y-4">
					<label class="block space-y-1 text-xs font-medium">
						<span>Rows</span>
						<select
							class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
							value={selectedRowCount}
							onchange={handleRowCountChange}
							data-testid="stress-row-count-select"
						>
							{#each AGENT_PANEL_STRESS_ROW_COUNT_PRESETS as option}
								<option value={option}>{option.toLocaleString()}</option>
							{/each}
						</select>
					</label>

					<label class="block space-y-1 text-xs font-medium">
						<span>Preset</span>
						<select
							class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
							value={selectedPreset}
							onchange={handlePresetChange}
							data-testid="stress-preset-select"
						>
							<option value="mixed">Mixed</option>
							<option value="text-heavy">Text heavy</option>
							<option value="tool-heavy">Tool heavy</option>
							<option value="streaming-tail">Streaming tail</option>
						</select>
					</label>

					<label class="block space-y-1 text-xs font-medium">
						<span>Renderer</span>
						<select
							class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
							value={selectedRendererMode}
							onchange={handleRendererModeChange}
							data-testid="stress-renderer-mode-select"
						>
							<option value="full">Full</option>
							<option value="text-only">Text only</option>
							<option value="shell-only">Shell only</option>
						</select>
					</label>

					<label class="block space-y-1 text-xs font-medium">
						<span>Seed</span>
						<input
							class="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
							type="number"
							min="0"
							value={seed}
							oninput={handleSeedInput}
							data-testid="stress-seed-input"
						/>
					</label>

					<label class="block space-y-1 text-xs font-medium">
						<span>Panel width</span>
						<input
							class="w-full"
							type="range"
							min="520"
							max="1200"
							step="20"
							value={panelWidth}
							oninput={handlePanelWidthInput}
							data-testid="stress-panel-width-input"
						/>
						<span class="block text-muted-foreground">{panelWidth}px</span>
					</label>

					<label class="flex items-center gap-2 text-xs font-medium">
						<input
							type="checkbox"
							checked={includeStreamingTail}
							onchange={handleStreamingTailChange}
							data-testid="stress-streaming-tail-toggle"
						/>
						<span>Streaming tail</span>
					</label>

					<button
						type="button"
						class="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						onclick={regenerateFixture}
						data-testid="stress-regenerate-button"
					>
						Regenerate
					</button>
				</div>

				<div class="mt-6 grid grid-cols-2 gap-2 text-xs" data-testid="stress-kind-counts">
					<div class="rounded-md border border-border p-2">
						<div class="text-muted-foreground">User</div>
						<div class="font-medium">{fixture.summary.kindCounts.user.toLocaleString()}</div>
					</div>
					<div class="rounded-md border border-border p-2">
						<div class="text-muted-foreground">Assistant</div>
						<div class="font-medium">{fixture.summary.kindCounts.assistantText.toLocaleString()}</div>
					</div>
					<div class="rounded-md border border-border p-2">
						<div class="text-muted-foreground">Thought</div>
						<div class="font-medium">{fixture.summary.kindCounts.assistantThought.toLocaleString()}</div>
					</div>
					<div class="rounded-md border border-border p-2">
						<div class="text-muted-foreground">Tool</div>
						<div class="font-medium">{fixture.summary.kindCounts.tool.toLocaleString()}</div>
					</div>
				</div>
			</aside>

			<section class="flex min-h-0 min-w-0 flex-col overflow-hidden">
				<div class="grid shrink-0 grid-cols-7 gap-px border-b border-border bg-border text-xs">
					<div class="bg-background p-3">
						<div class="text-muted-foreground">Generate</div>
						<div class="font-medium">{metricSummary.generationMsLabel}</div>
					</div>
					<div class="bg-background p-3" data-testid="stress-metric-render-ms">
						<div class="text-muted-foreground">Render</div>
						<div class="font-medium">{metricSummary.renderSettleMsLabel}</div>
					</div>
					<div class="bg-background p-3">
						<div class="text-muted-foreground">Rows in DOM</div>
						<div class="font-medium">{metricSummary.domRowCount.toLocaleString()}</div>
					</div>
					<div class="bg-background p-3">
						<div class="text-muted-foreground">Jank frames</div>
						<div class="font-medium">{metricSummary.jankFrameCount}</div>
					</div>
					<div class="bg-background p-3" data-testid="stress-metric-scroll-update-ms">
						<div class="text-muted-foreground">Scroll update</div>
						<div class="font-medium">
							{metricSummary.averageScrollUpdateMs === null ? "unavailable" : `${metricSummary.averageScrollUpdateMs} / ${metricSummary.maxScrollUpdateMs} ms`}
						</div>
					</div>
					<div class="bg-background p-3">
						<div class="text-muted-foreground">Avg frame</div>
						<div class="font-medium">
							{metricSummary.averageFrameDeltaMs === null ? "unavailable" : `${metricSummary.averageFrameDeltaMs} ms`}
						</div>
					</div>
					<div class="bg-background p-3">
						<div class="text-muted-foreground">Memory</div>
						<div class="truncate font-medium">{metricSummary.memoryLabel}</div>
					</div>
				</div>

				<div class="flex min-h-0 flex-1 overflow-hidden bg-muted/20 p-4">
					<div
						class="flex h-full min-h-0 min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background"
						style:width={`${panelWidth}px`}
						bind:this={transcriptHost}
						data-testid="stress-transcript-host"
					>
						{#if selectedRendererMode === "full"}
							<SceneContentViewport
								panelId={PANEL_ID}
								sceneEntries={fixture.sceneEntries}
								rowsProjection={fixture.rowsProjection}
								{turnState}
								projectPath={DEFAULT_PROJECT_PATH}
								sessionId={fixture.sessionId}
									skipRowsBootstrap={true}
									pendingUserRevealRequestKey={sendAttachPendingUserRevealRequestKey}
									{localPlaceholderMode}
									showWorkingSpark={includeStreamingTail}
								isFullscreen={false}
								modifiedFilesState={null}
								profileRecorder={recordProfileSample}
								onFollowStateChange={handleSendAttachFollowStateChange}
							/>
						{:else}
							<MessageScroller
								itemSource={diagnosticScrollerItemSource}
								renderItem={renderDiagnosticItem}
								ariaLabel="Stress transcript diagnostic"
								profileRecorder={recordProfileSample}
							/>
						{/if}
					</div>
				</div>

				<div class="h-40 shrink-0 border-t border-border bg-background p-3">
					<textarea
						class="h-full w-full resize-none rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-4 text-muted-foreground"
						readonly
						value={dumpJson}
						data-testid="stress-json-dump"
					></textarea>
				</div>
			</section>
		</main>
	</div>
{/if}

<style>
	.stress-diagnostic-row {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr);
		align-items: start;
		gap: 0.75rem;
		min-width: 0;
		width: 100%;
		max-width: 100%;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
		background: var(--background);
		color: var(--foreground);
		contain: layout style paint;
	}

	.stress-diagnostic-row--shell {
		display: block;
		padding: 0;
		background: color-mix(in srgb, var(--muted) 45%, transparent);
	}

	.stress-diagnostic-row__label {
		min-width: 0;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1rem;
	}

	.stress-diagnostic-row__text {
		min-width: 0;
		overflow: hidden;
		color: var(--foreground);
		font-size: 0.8125rem;
		line-height: 1.25rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stress-diagnostic-row--user {
		background: color-mix(in srgb, var(--muted) 32%, transparent);
	}

	.stress-diagnostic-row--assistantThought {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.stress-diagnostic-row--tool {
		background: color-mix(in srgb, var(--secondary) 28%, transparent);
	}
</style>
