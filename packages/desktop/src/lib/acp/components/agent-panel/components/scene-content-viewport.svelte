<script lang="ts">
import { setIconConfig } from "@acepe/ui/icon-context";
import {
	MessageScroller,
	measureAgentPanelPerformance,
	rowEstimatePx,
	type AgentPanelPerformanceRecorder,
	type AgentPanelPlanActionEvent,
	type AgentPanelPlanViewEvent,
	type AgentPanelQuestionSelectEvent,
	type AgentPanelReviewActionEvent,
	type AgentTaskDetailPresentation,
	type AgentPanelSceneEntryModel,
	type AgentUserFileSelectEvent,
	type AgentToolFileSelectEvent,
	type AssistantRenderBlockContext,
	type MessageScrollerItem,
	type MessageScrollerRangeState,
	type StickToBottomController,
} from "@acepe/ui/agent-panel";
import { setContext } from "svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import type { TranscriptRowsState } from "../../../store/transcript-rows-store.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type { LocalPlaceholderMode } from "../logic/local-placeholder-mode.js";
import {
	getPermissionStore,
	type PermissionStore,
} from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import TranscriptViewportRowRenderer from "./transcript-viewport-row-renderer.svelte";
import {
	createRenderableTranscriptViewportRowSource,
	createRenderedTranscriptViewportRowResolver,
} from "../logic/transcript-viewport-rendered-rows.js";
import type { RenderableTranscriptViewportRow } from "../logic/transcript-viewport-rendered-rows.js";
import {
	createTaskTranscriptDialogController,
	taskTranscriptDialogIdentity,
} from "../logic/task-transcript-dialog-controller.svelte.js";
import { taskTranscriptDialogPresentation } from "../logic/task-transcript-dialog-presentation.js";
import { createSyntheticReviewEntry } from "../logic/synthetic-review-entry.js";
import { recordPanelOpenPerformanceMark } from "../logic/panel-open-performance-mark.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";

const SEND_REVEAL_PEEK_PX = 72;
const OLDER_ROWS_PREFETCH_ROW_THRESHOLD = 48;
const OLDER_ROWS_PREFETCH_BEFORE_PX = 4_800;
const OLDER_ROWS_INITIAL_PAINT_SETTLE_MS = 80;
const OLDER_ROWS_PAINT_GATE_FALLBACK_MS = 200;
const UNLOADED_ROW_ESTIMATE_SAMPLE_LIMIT = 256;
const FALLBACK_UNLOADED_ROW_ESTIMATE_PX = rowEstimatePx("tool");

type SceneContentViewportProps = {
	panelId: string;
	optimisticUserEntry?: AgentPanelSceneEntryModel | null;
	rowsProjection?: TranscriptRowsState | null;
	turnState: TurnState;
	projectPath: string | undefined;
	sessionId: string | null;
	skipRowsBootstrap?: boolean;
	pendingUserRevealRequestKey?: string | null;
	localPlaceholderMode?: LocalPlaceholderMode;
	planningPlaceholderPresentation?: {
		readonly label: string;
		readonly agentIconSrc: string | null;
		readonly showWorkingSpark: boolean;
	} | null;
	showWorkingSpark?: boolean;
	isFullscreen?: boolean;
	modifiedFilesState?: ModifiedFilesState | null;
	suppressSyntheticReviewEntry?: boolean;
	onNearBottomChange?: (isNearBottom: boolean) => void;
	onNearTopChange?: (isNearTop: boolean) => void;
	onFollowStateChange?: (state: {
		readonly released: boolean;
		readonly hasUnreadBelow: boolean;
	}) => void;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	onUserFileSelect?: (event: AgentUserFileSelectEvent) => void;
	onReview?: (event: AgentPanelReviewActionEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	profileRecorder?: AgentPanelPerformanceRecorder;
};

const permissionStore: PermissionStore | undefined = getPermissionStore();
const sessionStore = getSessionStore();
const taskTranscriptDialogController = createTaskTranscriptDialogController();

type TaskTranscriptDialogBinding = {
	readonly presentation: AgentTaskDetailPresentation;
	readonly onOpenChange: (open: boolean) => void;
	readonly onLoadMore: () => void;
};

let {
	panelId,
	optimisticUserEntry = null,
	rowsProjection = null,
	turnState,
	projectPath,
	sessionId,
	skipRowsBootstrap = false,
	pendingUserRevealRequestKey = null,
	localPlaceholderMode = "none",
	planningPlaceholderPresentation = null,
	showWorkingSpark = false,
	isFullscreen = false,
	modifiedFilesState = null,
	suppressSyntheticReviewEntry = false,
	onNearBottomChange,
	onNearTopChange,
	onFollowStateChange,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	onUserFileSelect,
	onReview,
	isPlanActionAvailable,
	profileRecorder,
}: SceneContentViewportProps = $props();

const themeState = useTheme();
const rowsDiagnostics = $derived(sessionStore.viewport.getRowsDiagnostics(sessionId));
const editToolTheme = $derived({
	theme: themeState.effectiveTheme,
	themeNames: { dark: "Cursor Dark", light: "pierre-light" },
	workerPool: getWorkerPool(),
	onBeforeRender: registerCursorThemeForPierreDiffs,
	unsafeCSS: pierreDiffsUnsafeCSS,
});

setIconConfig({ basePath: "/svgs/icons" });
setContext(SESSION_CONTEXT_KEY_EXPORT, {
	get sessionId() {
		return sessionId ?? undefined;
	},
	get panelId() {
		return panelId;
	},
	get projectPath() {
		return projectPath;
	},
	get turnState() {
		return turnState;
	},
	get modifiedFilesState() {
		return modifiedFilesState ?? undefined;
	},
});

let consumedPendingUserRevealRequestKey = $state<string | null>(null);
let bootstrappedSessionId: string | null = null;
let openedAtSessionId = $state<string | null>(null);
let scrollerController = $state<StickToBottomController | null>(null);
let lastScrollerContentSignature = $state<string | null>(null);
let recordedPropsMarkPanelId: string | null = null;
let olderRowsGateSessionId: string | null = null;
let olderRowsGateOpen = false;
let olderRowsGateScheduledSessionId: string | null = null;
let pendingOlderRowsSessionId: string | null = null;
let pendingOlderRowsAfterScrollSessionId: string | null = null;
let scrollerScrollActive = false;

const bufferRows = $derived(rowsProjection?.rows ?? []);
const syntheticReviewEntry = $derived(
	suppressSyntheticReviewEntry
		? null
		: createSyntheticReviewEntry({ turnState, modifiedFilesState })
);
const renderableRowSource = $derived.by(() => {
	return measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "scene-content.build-renderable-rows", itemCount: bufferRows.length },
		() =>
			createRenderableTranscriptViewportRowSource({
				bufferRows,
				bufferStartIndex: rowsProjection?.loadedStartRowIndex ?? 0,
				optimisticUserEntry,
				localPlaceholderMode,
				syntheticReviewEntry,
			})
	);
});
const virtualLeadingSpacePx = $derived.by(() => {
	const loadedStartRowIndex = rowsProjection?.loadedStartRowIndex ?? 0;
	if (!Number.isInteger(loadedStartRowIndex) || loadedStartRowIndex <= 0) {
		return 0;
	}
	const sampleCount = Math.min(UNLOADED_ROW_ESTIMATE_SAMPLE_LIMIT, renderableRowSource.length);
	const sampleStartIndex = Math.max(0, renderableRowSource.length - sampleCount);
	let estimateTotalPx = 0;
	let measuredEstimateCount = 0;
	for (let offset = 0; offset < sampleCount; offset += 1) {
		const estimatePx = renderableRowSource.getEstimatePx(sampleStartIndex + offset);
		if (Number.isFinite(estimatePx) && estimatePx > 0) {
			estimateTotalPx += estimatePx;
			measuredEstimateCount += 1;
		}
	}
	const rowEstimate =
		measuredEstimateCount > 0
			? estimateTotalPx / measuredEstimateCount
			: FALLBACK_UNLOADED_ROW_ESTIMATE_PX;
	return loadedStartRowIndex * rowEstimate;
});
const resolveRenderedRow = $derived.by(() => {
	return measureAgentPanelPerformance(
		profileRecorder,
		{
			phase: "scene-content.build-rendered-row-resolver",
			itemCount: bufferRows.length,
		},
		() =>
			createRenderedTranscriptViewportRowResolver({
				optimisticUserEntry,
				planningPlaceholderPresentation,
				syntheticReviewEntry,
			})
	);
});

$effect(() => {
	if (sessionId === null) {
		return;
	}
	const revision = sessionStore.read?.getSessionGraphRevision(sessionId) ?? null;
	if (revision === null) {
		return;
	}

	for (let index = 0; index < renderableRowSource.length; index += 1) {
		const renderable = renderableRowSource.getRenderable(index);
		if (renderable === undefined) {
			continue;
		}
		const rendered = resolveRenderedRow(renderable);
		const entry = rendered.entry;
		if (
			entry.type !== "tool_call" ||
			entry.kind !== "task" ||
			entry.taskTranscriptScope?.kind !== "operation"
		) {
			continue;
		}
		const scope = {
			kind: "operation" as const,
			operationId: entry.taskTranscriptScope.operationId,
		};
		const identity = taskTranscriptDialogIdentity({
			sessionId,
			panelId,
			rootRowId: rendered.row.rowId,
			operationId: scope.operationId,
		});
		taskTranscriptDialogController.syncOpenRevision({
			identity,
			scope,
			revision,
		});
	}
});

function getScrollerItemRenderable(item: MessageScrollerItem): RenderableTranscriptViewportRow {
	return item as RenderableTranscriptViewportRow;
}

function taskTranscriptDialogBindingFor(
	rowId: string,
	entry: AgentPanelSceneEntryModel
): TaskTranscriptDialogBinding | null {
	if (
		sessionId === null ||
		entry.type !== "tool_call" ||
		entry.kind !== "task" ||
		entry.taskTranscriptScope?.kind !== "operation"
	) {
		return null;
	}

	const scope = {
		kind: "operation" as const,
		operationId: entry.taskTranscriptScope.operationId,
	};
	const identity = taskTranscriptDialogIdentity({
		sessionId,
		panelId,
		rootRowId: rowId,
		operationId: scope.operationId,
	});

	return {
		presentation: taskTranscriptDialogPresentation(
			taskTranscriptDialogController.getState(identity)
		),
		onOpenChange(open: boolean): void {
			if (!open) {
				taskTranscriptDialogController.close(identity);
				return;
			}
			const revision = sessionStore.read.getSessionGraphRevision(identity.sessionId);
			if (revision === null) {
				return;
			}
			taskTranscriptDialogController.setOpen({
				identity,
				scope,
				revision,
				open: true,
			});
		},
		onLoadMore(): void {
			taskTranscriptDialogController.loadNextPage(identity);
		},
	};
}

function buildScrollerContentSignature(): string {
	const itemCount = renderableRowSource.length;
	const firstKey = renderableRowSource.getKey(0) ?? "";
	const lastKey = renderableRowSource.getKey(itemCount - 1) ?? "";
	const emissionSeq = rowsProjection?.emissionSeq ?? "none";
	return `${itemCount}:${emissionSeq}:${firstKey}:${lastKey}`;
}

function latestVisibleUserRowId(): string | null {
	return renderableRowSource.getLastUserRowId();
}

function revealLatestUserAsSendIntent(): void {
	scrollerController?.onSend();
}

function openAtLatestUserTurn(): void {
	const rowId = latestVisibleUserRowId();
	if (rowId === null) {
		scrollerController?.jumpToLatest();
		return;
	}
	scrollerController?.openAt(rowId, SEND_REVEAL_PEEK_PX);
}

function setScrollerController(controller: StickToBottomController): void {
	scrollerController = controller;
}

function afterInitialPaintSettle(callback: () => void): void {
	let didRun = false;
	let fallbackTimerId: ReturnType<typeof setTimeout> | null = null;
	let settleTimerId: ReturnType<typeof setTimeout> | null = null;
	const runOnce = () => {
		if (didRun) {
			return;
		}
		didRun = true;
		if (fallbackTimerId !== null) {
			clearTimeout(fallbackTimerId);
			fallbackTimerId = null;
		}
		if (settleTimerId !== null) {
			clearTimeout(settleTimerId);
			settleTimerId = null;
		}
		callback();
	};
	const scheduleSettleTimer = () => {
		if (didRun || settleTimerId !== null) {
			return;
		}
		settleTimerId = setTimeout(runOnce, OLDER_ROWS_INITIAL_PAINT_SETTLE_MS);
	};

	if (typeof requestAnimationFrame !== "function") {
		settleTimerId = setTimeout(runOnce, OLDER_ROWS_INITIAL_PAINT_SETTLE_MS);
		return;
	}

	fallbackTimerId = setTimeout(runOnce, OLDER_ROWS_PAINT_GATE_FALLBACK_MS);
	requestAnimationFrame(() => {
		requestAnimationFrame(scheduleSettleTimer);
	});
}

function scheduleOlderRowsGateOpen(targetSessionId: string): void {
	if (olderRowsGateScheduledSessionId === targetSessionId) {
		return;
	}
	olderRowsGateScheduledSessionId = targetSessionId;
	afterInitialPaintSettle(() => {
		if (olderRowsGateSessionId !== targetSessionId || sessionId !== targetSessionId) {
			if (olderRowsGateScheduledSessionId === targetSessionId) {
				olderRowsGateScheduledSessionId = null;
			}
			return;
		}
		olderRowsGateOpen = true;
		olderRowsGateScheduledSessionId = null;
		if (pendingOlderRowsSessionId !== targetSessionId) {
			return;
		}
		pendingOlderRowsSessionId = null;
		sessionStore.viewport.requestOlderRows(targetSessionId);
	});
}

function requestOlderRowsAfterFirstPaint(targetSessionId: string): void {
	if (olderRowsGateSessionId !== targetSessionId) {
		olderRowsGateSessionId = targetSessionId;
		olderRowsGateOpen = false;
		olderRowsGateScheduledSessionId = null;
		pendingOlderRowsSessionId = null;
	}
	if (!olderRowsGateOpen) {
		pendingOlderRowsSessionId = targetSessionId;
		scheduleOlderRowsGateOpen(targetSessionId);
		return;
	}
	sessionStore.viewport.requestOlderRows(targetSessionId);
}

function requestOlderRowsWhenScrollSettled(targetSessionId: string, scrollActive: boolean): void {
	if (scrollActive) {
		pendingOlderRowsAfterScrollSessionId = targetSessionId;
		return;
	}
	requestOlderRowsAfterFirstPaint(targetSessionId);
}

function flushPendingOlderRowsAfterScroll(state: MessageScrollerRangeState): void {
	const targetSessionId = pendingOlderRowsAfterScrollSessionId;
	if (targetSessionId === null || state.scrollActive || sessionId !== targetSessionId) {
		return;
	}
	pendingOlderRowsAfterScrollSessionId = null;
	requestOlderRowsAfterFirstPaint(targetSessionId);
}

function handleEdgeStateChange(state: {
	readonly atTop: boolean;
	readonly atBottom: boolean;
}): void {
	if (state.atTop && sessionId !== null) {
		requestOlderRowsWhenScrollSettled(sessionId, scrollerScrollActive);
	}
	onNearTopChange?.(state.atTop);
	onNearBottomChange?.(state.atBottom);
}

function handleVisibleRangeChange(state: MessageScrollerRangeState): void {
	scrollerScrollActive = state.scrollActive;
	if (sessionId === null) {
		pendingOlderRowsAfterScrollSessionId = null;
		return;
	}
	if (
		pendingOlderRowsAfterScrollSessionId !== null &&
		pendingOlderRowsAfterScrollSessionId !== sessionId
	) {
		pendingOlderRowsAfterScrollSessionId = null;
	}
	flushPendingOlderRowsAfterScroll(state);
	if (state.itemCount === 0) {
		return;
	}
	const loadedStartRowIndex = rowsProjection?.loadedStartRowIndex ?? null;
	if (loadedStartRowIndex === null || loadedStartRowIndex <= 0) {
		return;
	}
	const nearLoadedStart =
		state.startIndex <= OLDER_ROWS_PREFETCH_ROW_THRESHOLD ||
		state.beforePx <= OLDER_ROWS_PREFETCH_BEFORE_PX;
	if (!nearLoadedStart) {
		return;
	}
	requestOlderRowsWhenScrollSettled(sessionId, state.scrollActive);
}

function getAttachedPermission(targetSessionId: string, toolCallId: string) {
	return permissionStore?.getForToolCall(targetSessionId, toolCallId);
}

$effect(() => {
	if (recordedPropsMarkPanelId === panelId) {
		return;
	}
	recordedPropsMarkPanelId = panelId;
	recordPanelOpenPerformanceMark(panelId, "scene-content:props");
});

// Bootstrap the ordered rows once per session. Rust owns row order and identity;
// this component owns only DOM scroll behavior.
$effect(() => {
	if (skipRowsBootstrap || sessionId === null || sessionId === bootstrappedSessionId) {
		return;
	}
	bootstrappedSessionId = sessionId;
	sessionStore.viewport.ensureRowsBootstrap(sessionId);
});

// Open a saved/restored conversation once at the latest user turn. Send intents
// use `onSend` below because they keep follow engaged for the streaming reply;
// this open-position path releases follow so history reading stays stable.
$effect(() => {
	if (sessionId === null) {
		openedAtSessionId = null;
		return;
	}
	if (
		scrollerController === null ||
		renderableRowSource.length === 0 ||
		openedAtSessionId === sessionId
	) {
		return;
	}
	openedAtSessionId = sessionId;
	openAtLatestUserTurn();
});

$effect(() => {
	if (
		pendingUserRevealRequestKey === null ||
		pendingUserRevealRequestKey === consumedPendingUserRevealRequestKey
	) {
		return;
	}
	consumedPendingUserRevealRequestKey = pendingUserRevealRequestKey;
	revealLatestUserAsSendIntent();
});

$effect(() => {
	if (scrollerController === null) {
		return;
	}
	const signature = measureAgentPanelPerformance(
		profileRecorder,
		{ phase: "scene-content.build-content-signature", itemCount: renderableRowSource.length },
		() => buildScrollerContentSignature()
	);
	if (signature === lastScrollerContentSignature) {
		return;
	}
	lastScrollerContentSignature = signature;
	queueMicrotask(() => {
		scrollerController?.notifyContentChanged();
	});
});

export function scrollToBottom(_options?: { force?: boolean }) {
	scrollerController?.jumpToLatest();
}

export function prepareForNextUserReveal(_options?: { force?: boolean }) {
	revealLatestUserAsSendIntent();
}

export function scrollToTop() {
	scrollerController?.scrollToTop();
}
</script>

<div
	class="h-full min-h-0 min-w-0 w-full flex overflow-hidden"
	data-testid="rust-transcript-viewport"
	data-dom-authority="true"
	data-buffer-start-index={rowsProjection?.loadedStartRowIndex}
	data-buffer-end-index={rowsProjection?.loadedEndRowIndex}
	data-buffer-row-count={rowsProjection?.rows.length}
	data-buffer-total-row-count={rowsProjection?.totalRowCount}
	data-buffer-emission-seq={rowsProjection?.emissionSeq}
	data-buffer-last-action={rowsDiagnostics?.action}
	data-buffer-last-status={rowsDiagnostics?.status}
	data-buffer-last-row-count={rowsDiagnostics?.rowCount}
	data-buffer-last-previous-row-count={rowsDiagnostics?.previousRowCount}
	data-buffer-last-emission-seq={rowsDiagnostics?.emissionSeq}
	data-buffer-last-request-generation={rowsDiagnostics?.requestGeneration}
	data-buffer-last-reason={rowsDiagnostics?.reason}
	data-session-present={sessionId !== null}
>
	{#snippet renderAssistantBlock(context: AssistantRenderBlockContext)}
		{#if context.group.type === "text"}
			<ContentBlockRouter
				block={{ type: "text", text: context.group.text }}
				isStreaming={context.isStreaming}
				{projectPath}
			/>
		{:else}
			<ContentBlockRouter block={context.group.block} {projectPath} />
		{/if}
	{/snippet}

	{#snippet renderScrollerItem(item: MessageScrollerItem)}
		{@const rendered = resolveRenderedRow(getScrollerItemRenderable(item))}
		<TranscriptViewportRowRenderer
			rowId={rendered.row.rowId}
			rowIndex={rendered.index}
			entry={rendered.entry}
			{sessionId}
			{projectPath}
			{showWorkingSpark}
			{isFullscreen}
			{editToolTheme}
			{renderAssistantBlock}
			{onQuestionSelect}
			{onPlanBuild}
			{onPlanCancel}
			{onPlanViewFull}
			{onToolFileSelect}
			{onUserFileSelect}
			{onReview}
			{isPlanActionAvailable}
			{getAttachedPermission}
			taskDetailBindingFor={taskTranscriptDialogBindingFor}
		/>
	{/snippet}

	{#if true}
		{@const _messageScrollerBefore = recordPanelOpenPerformanceMark(panelId, "scene-content:message-scroller-before")}
	{/if}
	<MessageScroller
		itemSource={renderableRowSource}
		{virtualLeadingSpacePx}
		renderItem={renderScrollerItem}
		ariaLabel="Conversation transcript"
		onReady={setScrollerController}
		onEdgeStateChange={handleEdgeStateChange}
		onVisibleRangeChange={handleVisibleRangeChange}
		{onFollowStateChange}
		{profileRecorder}
	/>
	{#if true}
		{@const _messageScrollerAfter = recordPanelOpenPerformanceMark(panelId, "scene-content:message-scroller-after")}
	{/if}
</div>
