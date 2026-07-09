<script lang="ts">
import { setIconConfig } from "@acepe/ui/icon-context";
import {
	MessageScroller,
	rowEstimatePx,
	type AgentPanelPlanActionEvent,
	type AgentPanelPlanViewEvent,
	type AgentPanelQuestionSelectEvent,
	type AgentPanelReviewActionEvent,
	type AgentPanelSceneEntryModel,
	type AgentToolFileSelectEvent,
	type AssistantRenderBlockContext,
	type MessageScrollerItem,
	type StickToBottomController,
} from "@acepe/ui/agent-panel";
import { setContext } from "svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import { renderKey } from "../../../store/transcript-rows-store.js";
import type { TranscriptRowsState } from "../../../store/transcript-rows-store.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import {
	getPermissionStore,
	type PermissionStore,
} from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import type { AgentPanelCanonicalSource } from "../../../session-state/agent-panel-canonical-source.js";
import { createViewportOperationSceneEntryResolver } from "../../../session-state/viewport-operation-scene-entry-resolver.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import TranscriptViewportRowRenderer from "./transcript-viewport-row-renderer.svelte";
import { buildRenderedTranscriptViewportRows } from "../logic/transcript-viewport-rendered-rows.js";
import type { RenderedTranscriptViewportRow } from "../logic/transcript-viewport-rendered-rows.js";
import { createSyntheticReviewEntry } from "../logic/synthetic-review-entry.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";

const EMPTY_SCENE_ENTRIES: readonly AgentPanelSceneEntryModel[] = [];
const SEND_REVEAL_PEEK_PX = 72;

type SceneContentViewportProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	rowsProjection?: TranscriptRowsState | null;
	turnState: TurnState;
	projectPath: string | undefined;
	sessionId: string | null;
	skipRowsBootstrap?: boolean;
	pendingUserRevealRequestKey?: string | null;
	showLocalPlanningIndicator?: boolean;
	planningPlaceholderPresentation?: {
		readonly label: string;
		readonly agentIconSrc: string | null;
		readonly showWorkingSpark: boolean;
	} | null;
	showWorkingSpark?: boolean;
	isFullscreen?: boolean;
	modifiedFilesState?: ModifiedFilesState | null;
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
	onReview?: (event: AgentPanelReviewActionEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	profileRecorder?: AgentPanelPerformanceRecorder;
};

const permissionStore: PermissionStore | undefined = getPermissionStore();
const sessionStore = getSessionStore();

let {
	panelId,
	sceneEntries,
	rowsProjection = null,
	turnState,
	projectPath,
	sessionId,
	canonicalSource = null,
	skipRowsBootstrap = false,
	pendingUserRevealRequestKey = null,
	showLocalPlanningIndicator = false,
	planningPlaceholderPresentation = null,
	showWorkingSpark = false,
	isFullscreen = false,
	modifiedFilesState = null,
	onNearBottomChange,
	onNearTopChange,
	onFollowStateChange,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	onReview,
	isPlanActionAvailable,
	profileRecorder,
}: SceneContentViewportProps = $props();

const chatPrefs = getChatPreferencesStore();
const themeState = useTheme();
const streamingAnimationMode = $derived(
	chatPrefs?.streamingAnimationMode ?? DEFAULT_STREAMING_ANIMATION_MODE
);
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

const bufferRows = $derived(rowsProjection?.rows ?? []);
const syntheticReviewEntry = $derived(
	createSyntheticReviewEntry({ turnState, modifiedFilesState })
);
const renderedRows = $derived.by(() => {
	return buildRenderedTranscriptViewportRows({
		bufferRows,
		bufferStartIndex: 0,
		sceneEntries: sceneEntries ?? EMPTY_SCENE_ENTRIES,
		showLocalPlanningIndicator,
		syntheticReviewEntry,
	});
});
const renderedRowsById = $derived.by(() => {
	const index = new Map<string, RenderedTranscriptViewportRow>();
	for (const rendered of renderedRows) {
		index.set(rendered.row.rowId, rendered);
	}
	return index;
});
const scrollerItems = $derived(renderedRows.map(toScrollerItem));

function toScrollerItem(rendered: RenderedTranscriptViewportRow): MessageScrollerItem {
	const row = rendered.row;
	return {
		key: renderKey(row),
		rowId: row.rowId,
		estimatePx: rowEstimatePx(row.kind),
		isActiveTail: row.activeStreamingTail !== null,
		anchorEligible: row.anchorEligible,
	};
}

function latestVisibleUserRowId(): string | null {
	for (let index = renderedRows.length - 1; index >= 0; index -= 1) {
		const row = renderedRows[index]?.row;
		if (row?.kind === "user") {
			return row.rowId;
		}
	}
	const rowEstimate =
		measuredEstimateCount > 0
			? estimateTotalPx / measuredEstimateCount
			: FALLBACK_UNLOADED_ROW_ESTIMATE_PX;
	return loadedStartRowIndex * rowEstimate;
});
const resolveRenderedRow = $derived.by(() => {
	const currentSceneEntries = sceneEntries ?? EMPTY_SCENE_ENTRIES;
	return measureAgentPanelPerformance(
		profileRecorder,
		{
			phase: "scene-content.build-rendered-row-resolver",
			itemCount: currentSceneEntries.length,
		},
		() =>
			createRenderedTranscriptViewportRowResolver({
				sceneEntries: currentSceneEntries,
				planningPlaceholderPresentation,
				syntheticReviewEntry,
				resolveOperationSceneEntry,
			})
	);
});
function getScrollerItemRenderable(item: MessageScrollerItem): RenderableTranscriptViewportRow {
	return item as RenderableTranscriptViewportRow;
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
	const rowId = latestVisibleUserRowId();
	if (rowId === null) {
		scrollerController?.jumpToLatest();
		return;
	}
	scrollerController?.onSend(rowId, SEND_REVEAL_PEEK_PX);
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

function requestOlderRowsWhenScrollSettled(
	targetSessionId: string,
	scrollActive: boolean
): void {
	if (scrollActive) {
		pendingOlderRowsAfterScrollSessionId = targetSessionId;
		return;
	}
	requestOlderRowsAfterFirstPaint(targetSessionId);
}

function flushPendingOlderRowsAfterScroll(state: MessageScrollerRangeState): void {
	const targetSessionId = pendingOlderRowsAfterScrollSessionId;
	if (
		targetSessionId === null ||
		state.scrollActive ||
		sessionId !== targetSessionId
	) {
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

function revealLatestUserAsSendIntent(): void {
	const rowId = latestVisibleUserRowId();
	if (rowId === null) {
		scrollerController?.jumpToLatest();
		return;
	}
	scrollerController?.onSend(rowId, SEND_REVEAL_PEEK_PX);
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

function handleEdgeStateChange(state: { readonly atTop: boolean; readonly atBottom: boolean }): void {
	onNearTopChange?.(state.atTop);
	onNearBottomChange?.(state.atBottom);
}

// Bootstrap the ordered rows once per session. Rust owns row order and identity;
// this component owns only DOM scroll behavior.
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
	if (scrollerController === null || renderedRows.length === 0 || openedAtSessionId === sessionId) {
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
	data-buffer-start-index={rowsProjection === null ? undefined : 0}
	data-buffer-end-index={rowsProjection?.rows.length}
	data-buffer-emission-seq={rowsProjection?.emissionSeq}
	data-session-present={sessionId !== null}
>
	{#snippet renderAssistantBlock(context: AssistantRenderBlockContext)}
		{#if context.group.type === "text"}
			<ContentBlockRouter
				block={{ type: "text", text: context.group.text }}
				isStreaming={context.isStreaming}
				tokenRevealCss={context.tokenRevealCss}
				{projectPath}
				{streamingAnimationMode}
			/>
		{:else}
			<ContentBlockRouter block={context.group.block} {projectPath} />
		{/if}
	{/snippet}

	{#snippet renderScrollerItem(item: MessageScrollerItem)}
		{@const rendered = renderedRowsById.get(item.rowId)}
		{#if rendered !== undefined}
			<TranscriptViewportRowRenderer
				renderedRows={[rendered]}
				{sessionId}
				{projectPath}
				{showWorkingSpark}
				{isFullscreen}
				{streamingAnimationMode}
				{editToolTheme}
				{renderAssistantBlock}
				{onQuestionSelect}
				{onPlanBuild}
				{onPlanCancel}
				{onPlanViewFull}
				{onToolFileSelect}
				{onReview}
				{isPlanActionAvailable}
				getAttachedPermission={(targetSessionId, toolCallId) =>
					permissionStore.getForToolCall(targetSessionId, toolCallId)}
			/>
		{/if}
	{/snippet}

	<MessageScroller
		items={scrollerItems}
		renderItem={renderScrollerItem}
		ariaLabel="Conversation transcript"
		onReady={setScrollerController}
		onEdgeStateChange={handleEdgeStateChange}
	/>
</div>
