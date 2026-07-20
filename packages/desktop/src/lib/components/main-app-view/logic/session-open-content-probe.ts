import type { AgentPanelPerformanceSample } from "@acepe/ui/agent-panel";
import type { PanelOpenPerformanceMarkName } from "$lib/acp/components/agent-panel/logic/panel-open-performance-mark.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import {
	type SessionOpenHydrationTimingRecord,
	setSessionOpenHydratorTimingRecorder,
} from "$lib/acp/store/services/session-open-hydrator.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type {
	TauriInvokeTimingRecord,
	TauriPendingInvokeRecord,
} from "$lib/utils/tauri-client/invoke.js";
import type { MainAppViewError } from "../errors/main-app-view-error.js";
import type { MainAppViewState } from "./main-app-view-state.svelte.js";
import {
	type OpenPersistedSessionDiagnosticEvent,
	setOpenPersistedSessionDiagnosticRecorder,
} from "./open-persisted-session.js";

export type SessionOpenContentProbeOptions = {
	readonly sessionId: string;
	readonly projectPath: string | null;
	readonly agentId: string | null;
	readonly sourcePath: string | null;
	readonly worktreePath?: string | null;
	readonly title?: string | null;
	readonly timeoutMs?: number;
	readonly closeExisting?: boolean;
	readonly closeAfter?: boolean;
};

export type SessionOpenContentProbeResult = {
	readonly hookAvailable: boolean;
	readonly sessionId: string;
	readonly panelId: string | null;
	readonly documentVisibilityAtStart: string;
	readonly documentVisibilityAtEnd: string;
	readonly documentHasFocusAtStart: boolean;
	readonly documentHasFocusAtEnd: boolean;
	readonly foregroundFrameTimingValid: boolean;
	readonly sessionKnownBeforeOpen: boolean;
	readonly placeholderRegistered: boolean;
	readonly closedExistingPanel: boolean;
	readonly closeAfterRequested: boolean;
	readonly selectCallMs: number | null;
	readonly panelDomReadyMs: number | null;
	readonly transcriptViewportReadyMs: number | null;
	readonly firstRowDomReadyMs: number | null;
	readonly firstRowPaintMs: number | null;
	readonly rowCountAtFirstPaint: number;
	readonly finalRowCount: number;
	readonly panelStillOpenAtEnd: boolean;
	readonly panelDomPresentAtEnd: boolean;
	readonly sessionKnownAtEnd: boolean;
	readonly sessionHasCanonicalProjectionAtEnd: boolean;
	readonly sessionCanSendAtEnd: boolean | null;
	readonly sessionLifecycleStatusAtEnd: string | null;
	readonly sessionMessageCountAtEnd: number | null;
	readonly timedOut: boolean;
	readonly errorMessage: string | null;
	readonly runtimeErrors: readonly string[];
	readonly tauriInvokeTimings: readonly TauriInvokeTimingRecord[];
	readonly pendingTauriInvokes: readonly TauriPendingInvokeRecord[];
	readonly openEvents: readonly OpenPersistedSessionDiagnosticEvent[];
	readonly hydrationTimings: readonly SessionOpenHydrationTimingRecord[];
	readonly panelOpenMarks: Readonly<Record<string, number>>;
	readonly agentPanelPerformanceSamples: readonly AgentPanelPerformanceSample[];
};

export type SessionOpenContentProbeDeps = {
	readonly document: Document;
	readonly hostWindow: Window;
	readonly performance: Performance;
	readonly viewState: Pick<MainAppViewState, "handleSelectSession" | "handleClosePanel">;
	readonly panelStore: Pick<PanelStore, "getPanelBySessionId">;
	readonly sessionStore: Pick<SessionStore, "read" | "loading">;
	readonly readRuntimeErrors: () => readonly string[];
	readonly readTauriInvokeTimings: () => readonly TauriInvokeTimingRecord[];
	readonly readPendingTauriInvokes: () => readonly TauriPendingInvokeRecord[];
};

type SelectSessionOutcome =
	| { readonly ok: true; readonly message: null }
	| { readonly ok: false; readonly message: string };

type SelectSessionProbeState = {
	outcome: SelectSessionOutcome | null;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function roundPerfMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/["\\]/g, "\\$&");
}

function panelSelector(panelId: string): string {
	return `[data-qa-agent-panel-id="${cssEscape(panelId)}"]`;
}

function rowSelector(panelId: string): string {
	return `${panelSelector(panelId)} [data-row-id]`;
}

function visibleElementExists(document: Document, selector: string): boolean {
	const node = document.querySelector<HTMLElement>(selector);
	if (node === null) {
		return false;
	}
	const style = getComputedStyle(node);
	const rect = node.getBoundingClientRect();
	return (
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		Number(style.opacity) > 0 &&
		rect.width > 0 &&
		rect.height > 0
	);
}

function elementExists(document: Document, selector: string): boolean {
	return document.querySelector(selector) !== null;
}

function countRows(document: Document, panelId: string): number {
	return document.querySelectorAll(rowSelector(panelId)).length;
}

function documentVisibility(document: Document): string {
	return typeof document.visibilityState === "string" ? document.visibilityState : "unknown";
}

function documentHasFocus(document: Document): boolean {
	return typeof document.hasFocus === "function" ? document.hasFocus() : false;
}

function waitForProbeFrame(hostWindow: Window): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const fallbackTimeout = hostWindow.setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			resolve();
		}, 16);
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			hostWindow.clearTimeout(fallbackTimeout);
			resolve();
		};
		if (typeof hostWindow.requestAnimationFrame === "function") {
			hostWindow.requestAnimationFrame(() => finish());
			return;
		}
		finish();
	});
}

function isOpenResultTerminalStage(stage: OpenPersistedSessionDiagnosticEvent["stage"]): boolean {
	return (
		stage === "result-found" ||
		stage === "result-missing" ||
		stage === "result-error" ||
		stage === "stale-panel" ||
		stage === "hydrated" ||
		stage === "request-failed" ||
		stage === "timed-out" ||
		stage === "finished"
	);
}

export function shouldWaitForSessionOpenResult(
	events: readonly OpenPersistedSessionDiagnosticEvent[]
): boolean {
	let requestStarted = false;
	for (const event of events) {
		if (event.stage === "request-started") {
			requestStarted = true;
		}
		if (isOpenResultTerminalStage(event.stage)) {
			return false;
		}
	}
	return requestStarted;
}

async function waitForOpenResultIfStarted(input: {
	readonly deps: Pick<SessionOpenContentProbeDeps, "performance" | "hostWindow">;
	readonly openEvents: readonly OpenPersistedSessionDiagnosticEvent[];
	readonly deadlineMs: number;
}): Promise<void> {
	while (
		input.deps.performance.now() < input.deadlineMs &&
		shouldWaitForSessionOpenResult(input.openEvents)
	) {
		await waitForDomFlush();
		await waitForProbeFrame(input.deps.hostWindow);
	}
}

async function waitForDomFlush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

async function waitForConditionUntil(
	deps: Pick<SessionOpenContentProbeDeps, "performance" | "hostWindow">,
	predicate: () => boolean,
	deadlineMs: number,
	startedAtMs: number
): Promise<number | null> {
	while (deps.performance.now() < deadlineMs) {
		if (predicate()) {
			return roundPerfMs(deps.performance.now() - startedAtMs);
		}
		await waitForDomFlush();
		if (predicate()) {
			return roundPerfMs(deps.performance.now() - startedAtMs);
		}
		await waitForProbeFrame(deps.hostWindow);
	}
	return null;
}

function registerPlaceholderIfNeeded(
	deps: SessionOpenContentProbeDeps,
	options: SessionOpenContentProbeOptions,
	sessionKnownBeforeOpen: boolean
): boolean {
	if (sessionKnownBeforeOpen) {
		return false;
	}
	if (options.projectPath === null || options.agentId === null) {
		return false;
	}
	deps.sessionStore.loading.registerSessionPlaceholder(
		options.sessionId,
		options.projectPath,
		options.agentId,
		{
			sourcePath: options.sourcePath ?? undefined,
			worktreePath: options.worktreePath ?? undefined,
			placeholderTitle: options.title ?? null,
		}
	);
	return true;
}

async function closeExistingPanelIfNeeded(
	deps: SessionOpenContentProbeDeps,
	sessionId: string,
	closeExisting: boolean,
	timeoutMs: number
): Promise<boolean> {
	if (!closeExisting) {
		return false;
	}
	const existingPanel = deps.panelStore.getPanelBySessionId(sessionId);
	if (existingPanel === undefined) {
		return false;
	}
	deps.viewState.handleClosePanel(existingPanel.id);
	const startedAtMs = deps.performance.now();
	while (deps.performance.now() - startedAtMs < timeoutMs) {
		if (deps.panelStore.getPanelBySessionId(sessionId) === undefined) {
			return true;
		}
		await waitForDomFlush();
		await waitForProbeFrame(deps.hostWindow);
	}
	return true;
}

function invokeTimingsSince(
	deps: SessionOpenContentProbeDeps,
	baselineIndex: number
): readonly TauriInvokeTimingRecord[] {
	return deps.readTauriInvokeTimings().slice(baselineIndex);
}

type PanelOpenMarkRecorder = (
	panelId: string,
	name: PanelOpenPerformanceMarkName,
	timestampMs: number
) => void;

type PanelOpenMarkWindow = Window & {
	__acepeRecordPanelOpenPerformanceMark?: PanelOpenMarkRecorder;
};

type AgentPanelPerformanceCaptureWindow = Window & {
	__acepeAgentPanelPerformanceSamples?: AgentPanelPerformanceSample[];
	__acepeAgentPanelPerformanceCaptureEnabled?: boolean;
	__acepeEnableAgentPanelPerformanceCapture?: () => void;
	__acepeDisableAgentPanelPerformanceCapture?: () => void;
	__acepeReadAgentPanelPerformanceCapture?: () => readonly AgentPanelPerformanceSample[];
};

function installPanelOpenMarkRecorder(input: {
	readonly hostWindow: Window;
	readonly startedAtMs: number;
}): {
	readonly marksByPanelId: Map<string, Record<string, number>>;
	readonly restore: () => void;
} {
	const markWindow = input.hostWindow as PanelOpenMarkWindow;
	const marksByPanelId = new Map<string, Record<string, number>>();
	const previousRecorder = markWindow.__acepeRecordPanelOpenPerformanceMark;
	markWindow.__acepeRecordPanelOpenPerformanceMark = (targetPanelId, name, timestampMs) => {
		let marks = marksByPanelId.get(targetPanelId);
		if (marks === undefined) {
			marks = {};
			marksByPanelId.set(targetPanelId, marks);
		}
		marks[name] = roundPerfMs(timestampMs - input.startedAtMs);
		previousRecorder?.(targetPanelId, name, timestampMs);
	};
	return {
		marksByPanelId,
		restore: () => {
			if (previousRecorder === undefined) {
				delete markWindow.__acepeRecordPanelOpenPerformanceMark;
				return;
			}
			markWindow.__acepeRecordPanelOpenPerformanceMark = previousRecorder;
		},
	};
}

function installAgentPanelPerformanceCapture(hostWindow: Window): { readonly restore: () => void } {
	const targetWindow = hostWindow as AgentPanelPerformanceCaptureWindow;
	targetWindow.__acepeAgentPanelPerformanceSamples = [];
	targetWindow.__acepeAgentPanelPerformanceCaptureEnabled = true;
	targetWindow.__acepeEnableAgentPanelPerformanceCapture?.();
	return {
		restore: () => {
			if (targetWindow.__acepeDisableAgentPanelPerformanceCapture !== undefined) {
				targetWindow.__acepeDisableAgentPanelPerformanceCapture();
				return;
			}
			targetWindow.__acepeAgentPanelPerformanceCaptureEnabled = false;
		},
	};
}

function readAgentPanelPerformanceSamples(
	hostWindow: Window
): readonly AgentPanelPerformanceSample[] {
	const targetWindow = hostWindow as AgentPanelPerformanceCaptureWindow;
	return (
		targetWindow.__acepeReadAgentPanelPerformanceCapture?.() ??
		targetWindow.__acepeAgentPanelPerformanceSamples?.slice() ??
		[]
	);
}

function buildResult(input: {
	readonly deps: SessionOpenContentProbeDeps;
	readonly options: SessionOpenContentProbeOptions;
	readonly baselineIndex: number;
	readonly panelId: string | null;
	readonly documentVisibilityAtStart: string;
	readonly documentHasFocusAtStart: boolean;
	readonly sessionKnownBeforeOpen: boolean;
	readonly placeholderRegistered: boolean;
	readonly closedExistingPanel: boolean;
	readonly selectCallMs: number | null;
	readonly panelDomReadyMs: number | null;
	readonly transcriptViewportReadyMs: number | null;
	readonly firstRowDomReadyMs: number | null;
	readonly firstRowPaintMs: number | null;
	readonly rowCountAtFirstPaint: number;
	readonly finalRowCount: number;
	readonly timedOut: boolean;
	readonly errorMessage: string | null;
	readonly openEvents: readonly OpenPersistedSessionDiagnosticEvent[];
	readonly hydrationTimings: readonly SessionOpenHydrationTimingRecord[];
	readonly panelOpenMarks: Readonly<Record<string, number>>;
}): SessionOpenContentProbeResult {
	const panelStillOpenAtEnd =
		input.panelId !== null &&
		input.deps.panelStore.getPanelBySessionId(input.options.sessionId)?.id === input.panelId;
	const panelDomPresentAtEnd =
		input.panelId !== null && elementExists(input.deps.document, panelSelector(input.panelId));
	const documentVisibilityAtEnd = documentVisibility(input.deps.document);
	const documentHasFocusAtEnd = documentHasFocus(input.deps.document);
	const foregroundFrameTimingValid =
		input.documentVisibilityAtStart === "visible" &&
		documentVisibilityAtEnd === "visible" &&
		input.documentHasFocusAtStart &&
		documentHasFocusAtEnd;
	return {
		hookAvailable: true,
		sessionId: input.options.sessionId,
		panelId: input.panelId,
		documentVisibilityAtStart: input.documentVisibilityAtStart,
		documentVisibilityAtEnd,
		documentHasFocusAtStart: input.documentHasFocusAtStart,
		documentHasFocusAtEnd,
		foregroundFrameTimingValid,
		sessionKnownBeforeOpen: input.sessionKnownBeforeOpen,
		placeholderRegistered: input.placeholderRegistered,
		closedExistingPanel: input.closedExistingPanel,
		closeAfterRequested: input.options.closeAfter !== false,
		selectCallMs: input.selectCallMs,
		panelDomReadyMs: input.panelDomReadyMs,
		transcriptViewportReadyMs: input.transcriptViewportReadyMs,
		firstRowDomReadyMs: input.firstRowDomReadyMs,
		firstRowPaintMs: input.firstRowPaintMs,
		rowCountAtFirstPaint: input.rowCountAtFirstPaint,
		finalRowCount: input.finalRowCount,
		panelStillOpenAtEnd,
		panelDomPresentAtEnd,
		sessionKnownAtEnd: input.deps.sessionStore.read.hasSession(input.options.sessionId),
		sessionHasCanonicalProjectionAtEnd: input.deps.sessionStore.read.hasSessionCanonicalProjection(
			input.options.sessionId
		),
		sessionCanSendAtEnd: input.deps.sessionStore.read.getSessionCanSend(input.options.sessionId),
		sessionLifecycleStatusAtEnd: input.deps.sessionStore.read.getSessionLifecycleStatus(
			input.options.sessionId
		),
		sessionMessageCountAtEnd: input.deps.sessionStore.read.getSessionMessageCount(
			input.options.sessionId
		),
		timedOut: input.timedOut,
		errorMessage: input.errorMessage,
		runtimeErrors: input.deps.readRuntimeErrors(),
		tauriInvokeTimings: invokeTimingsSince(input.deps, input.baselineIndex),
		pendingTauriInvokes: input.deps.readPendingTauriInvokes(),
		openEvents: input.openEvents,
		hydrationTimings: input.hydrationTimings,
		panelOpenMarks: input.panelOpenMarks,
		agentPanelPerformanceSamples: readAgentPanelPerformanceSamples(input.deps.hostWindow),
	};
}

export async function runSessionOpenContentProbe(
	deps: SessionOpenContentProbeDeps,
	options: SessionOpenContentProbeOptions
): Promise<SessionOpenContentProbeResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const documentVisibilityAtStart = documentVisibility(deps.document);
	const documentHasFocusAtStart = documentHasFocus(deps.document);
	const sessionKnownBeforeOpen = deps.sessionStore.read.hasSession(options.sessionId);
	const placeholderRegistered = registerPlaceholderIfNeeded(deps, options, sessionKnownBeforeOpen);
	const closedExistingPanel = await closeExistingPanelIfNeeded(
		deps,
		options.sessionId,
		options.closeExisting === true,
		1_000
	);
	const baselineIndex = deps.readTauriInvokeTimings().length;
	const startedAtMs = deps.performance.now();
	const deadlineMs = startedAtMs + timeoutMs;
	const openEvents: OpenPersistedSessionDiagnosticEvent[] = [];
	const hydrationTimings: SessionOpenHydrationTimingRecord[] = [];
	const panelOpenMarks = installPanelOpenMarkRecorder({
		hostWindow: deps.hostWindow,
		startedAtMs,
	});
	const agentPanelPerformanceCapture = installAgentPanelPerformanceCapture(deps.hostWindow);
	const restoreOpenDiagnostics = setOpenPersistedSessionDiagnosticRecorder((event) => {
		openEvents.push(event);
	});
	const restoreHydrationTimings = setSessionOpenHydratorTimingRecorder((record) => {
		hydrationTimings.push(record);
	});
	const restoreRecorders = (): void => {
		restoreOpenDiagnostics();
		restoreHydrationTimings();
		panelOpenMarks.restore();
		agentPanelPerformanceCapture.restore();
	};

	const selectStartedAtMs = deps.performance.now();
	let selectCallMs: number | null = null;
	const selectState: SelectSessionProbeState = { outcome: null };
	const selectPromise = deps.viewState
		.handleSelectSession(options.sessionId)
		.match(
			(): SelectSessionOutcome => ({ ok: true, message: null }),
			(error: MainAppViewError): SelectSessionOutcome => ({
				ok: false,
				message: error.message,
			})
		)
		.then((outcome) => {
			selectCallMs = roundPerfMs(deps.performance.now() - selectStartedAtMs);
			selectState.outcome = outcome;
			return outcome;
		});

	let panelId: string | null = null;
	while (deps.performance.now() < deadlineMs) {
		panelId = deps.panelStore.getPanelBySessionId(options.sessionId)?.id ?? null;
		if (panelId !== null) {
			break;
		}
		if (selectState.outcome?.ok === false) {
			break;
		}
		await waitForDomFlush();
		await waitForProbeFrame(deps.hostWindow);
	}

	if (selectState.outcome?.ok === false) {
		restoreRecorders();
		return buildResult({
			deps,
			options,
			baselineIndex,
			panelId: null,
			documentVisibilityAtStart,
			documentHasFocusAtStart,
			sessionKnownBeforeOpen,
			placeholderRegistered,
			closedExistingPanel,
			selectCallMs,
			panelDomReadyMs: null,
			transcriptViewportReadyMs: null,
			firstRowDomReadyMs: null,
			firstRowPaintMs: null,
			rowCountAtFirstPaint: 0,
			finalRowCount: 0,
			timedOut: false,
			errorMessage: selectState.outcome.message,
			openEvents,
			hydrationTimings,
			panelOpenMarks: {},
		});
	}

	if (panelId === null) {
		const finalSelectOutcome = await selectPromise;
		restoreRecorders();
		return buildResult({
			deps,
			options,
			baselineIndex,
			panelId,
			documentVisibilityAtStart,
			documentHasFocusAtStart,
			sessionKnownBeforeOpen,
			placeholderRegistered,
			closedExistingPanel,
			selectCallMs,
			panelDomReadyMs: null,
			transcriptViewportReadyMs: null,
			firstRowDomReadyMs: null,
			firstRowPaintMs: null,
			rowCountAtFirstPaint: 0,
			finalRowCount: 0,
			timedOut: finalSelectOutcome.ok,
			errorMessage: finalSelectOutcome.ok
				? "Panel did not open before timeout."
				: finalSelectOutcome.message,
			openEvents,
			hydrationTimings,
			panelOpenMarks: {},
		});
	}

	const panelDomReadyMs = await waitForConditionUntil(
		deps,
		() => elementExists(deps.document, panelSelector(panelId)),
		deadlineMs,
		startedAtMs
	);
	const transcriptViewportReadyMs = await waitForConditionUntil(
		deps,
		() =>
			visibleElementExists(
				deps.document,
				`${panelSelector(panelId)} [data-testid="rust-transcript-viewport"]`
			),
		deadlineMs,
		startedAtMs
	);
	const firstRowDomReadyMs = await waitForConditionUntil(
		deps,
		() => countRows(deps.document, panelId) > 0,
		deadlineMs,
		startedAtMs
	);
	let firstRowPaintMs: number | null = null;
	let rowCountAtFirstPaint = 0;
	if (firstRowDomReadyMs !== null) {
		await waitForProbeFrame(deps.hostWindow);
		await waitForProbeFrame(deps.hostWindow);
		firstRowPaintMs = roundPerfMs(deps.performance.now() - startedAtMs);
		rowCountAtFirstPaint = countRows(deps.document, panelId);
	}
	await waitForOpenResultIfStarted({
		deps,
		openEvents,
		deadlineMs,
	});
	await waitForProbeFrame(deps.hostWindow);
	const finalRowCount = countRows(deps.document, panelId);

	if (options.closeAfter !== false) {
		deps.viewState.handleClosePanel(panelId);
		const closeStartedAtMs = deps.performance.now();
		while (deps.performance.now() - closeStartedAtMs < 1_000) {
			if (deps.panelStore.getPanelBySessionId(options.sessionId) === undefined) {
				break;
			}
			await waitForDomFlush();
			await waitForProbeFrame(deps.hostWindow);
		}
	}

	const timedOut =
		panelDomReadyMs === null || transcriptViewportReadyMs === null || firstRowDomReadyMs === null;
	restoreRecorders();
	const resolvedPanelOpenMarks = panelOpenMarks.marksByPanelId.get(panelId) ?? {};
	return buildResult({
		deps,
		options,
		baselineIndex,
		panelId,
		documentVisibilityAtStart,
		documentHasFocusAtStart,
		sessionKnownBeforeOpen,
		placeholderRegistered,
		closedExistingPanel,
		selectCallMs,
		panelDomReadyMs,
		transcriptViewportReadyMs,
		firstRowDomReadyMs,
		firstRowPaintMs,
		rowCountAtFirstPaint,
		finalRowCount,
		timedOut,
		errorMessage: timedOut ? "First transcript row did not appear before timeout." : null,
		openEvents,
		hydrationTimings,
		panelOpenMarks: resolvedPanelOpenMarks,
	});
}
