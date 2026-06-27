<script lang="ts">
import { setIconConfig } from "@acepe/ui/icon-context";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelSceneEntryModel,
	AgentToolFileSelectEvent,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import { setContext } from "svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import type { BufferProjection } from "../../../store/transcript-viewport-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type {
	SessionStateEnvelope,
} from "../../../../services/acp-types.js";
import { getChatPreferencesStore } from "../../../store/chat-preferences-store.svelte.js";
import { getPermissionStore } from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { ViewportSessionNotAttachedAcpError } from "../../../errors/acp-error.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import TranscriptViewportRowRenderer from "./transcript-viewport-row-renderer.svelte";
import { TranscriptViewportWebviewAdapter } from "../logic/transcript-viewport-webview-adapter.svelte.js";
import { buildRenderedTranscriptViewportRows } from "../logic/transcript-viewport-rendered-rows.js";
import type { AppError } from "../../../errors/app-error.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";
import { tick } from "svelte";

const EMPTY_SCENE_ENTRIES: readonly AgentPanelSceneEntryModel[] = [];

type SceneContentViewportProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	bufferProjection?: BufferProjection | null;
	turnState: TurnState;
	projectPath: string | undefined;
	sessionId: string | null;
	pendingUserRevealRequestKey?: string | null;
	showLocalPlanningIndicator?: boolean;
	showWorkingSpark?: boolean;
	isFullscreen?: boolean;
	modifiedFilesState?: ModifiedFilesState | null;
	onNearBottomChange?: (isNearBottom: boolean) => void;
	onNearTopChange?: (isNearTop: boolean) => void;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
};

const permissionStore = getPermissionStore();
const sessionStore = getSessionStore();

let {
	panelId,
	sceneEntries,
	bufferProjection = null,
	turnState,
	projectPath,
	sessionId,
	pendingUserRevealRequestKey = null,
	showLocalPlanningIndicator = false,
	showWorkingSpark = false,
	isFullscreen = false,
	modifiedFilesState = null,
	onNearBottomChange,
	onNearTopChange,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	isPlanActionAvailable,
}: SceneContentViewportProps = $props();

const chatPrefs = getChatPreferencesStore();
const themeState = useTheme();
const streamingAnimationMode = $derived(
	chatPrefs?.streamingAnimationMode ?? DEFAULT_STREAMING_ANIMATION_MODE
);
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

let lastViewportHeightPx = $state(720);
let consumedPendingUserRevealRequestKey = $state<string | null>(null);
let bootstrappedSessionId: string | null = null;

const bufferRows = $derived(bufferProjection?.rows ?? []);
const renderedRows = $derived.by(() => {
	const startIndex = bufferProjection?.bufferStartIndex ?? 0;
	const offsets = bufferProjection?.offsetsPx ?? [];
	return buildRenderedTranscriptViewportRows({
		bufferRows,
		offsetsPx: offsets,
		bufferStartIndex: startIndex,
		sceneEntries: sceneEntries ?? EMPTY_SCENE_ENTRIES,
		showLocalPlanningIndicator,
	});
});

const totalHeightPx = $derived(bufferProjection?.totalHeightPx ?? 0);

const viewportClientScroll = $derived(sessionStore.viewport.getClientScrollState(sessionId));

// Anchor for the flow-layout window: the canonical top of the first buffered
// row. Rows below it flow naturally (block/flex column) so intra-window layout
// can never overlap or gap regardless of estimate-vs-actual height drift.
// Canonical offsets still own the scrollbar (totalHeightPx) and refill math.
const windowTopPx = $derived(renderedRows[0]?.offsetPx ?? 0);

const viewportAdapter = new TranscriptViewportWebviewAdapter({
	getSessionId: () => sessionId,
	getBufferProjection: () => bufferProjection,
	getBufferRows: () => bufferRows,
	getViewportClientScroll: () => viewportClientScroll,
	getTotalHeightPx: () => totalHeightPx,
	getLastViewportHeightPx: () => lastViewportHeightPx,
	setLastViewportHeightPx: (heightPx) => {
		lastViewportHeightPx = heightPx;
	},
	getRevision: () => bufferProjection?.revision ?? null,
	isDispatchSuppressed,
	nextViewportRequestGeneration,
	applyEnvelope,
	handleDispatchError,
	viewportState: {
		isOutsideBuffer: (targetSessionId, scrollTopPx, viewportHeightPx) =>
			sessionStore.viewport.isOutsideBuffer(targetSessionId, scrollTopPx, viewportHeightPx),
		needsRefill: (targetSessionId, scrollTopPx, viewportHeightPx, thresholdPx) =>
			sessionStore.viewport.needsRefill(
				targetSessionId,
				scrollTopPx,
				viewportHeightPx,
				thresholdPx
			),
		setPendingOutsideBufferScrollTopPx: (
			targetSessionId,
			pendingOutsideBufferScrollTopPx,
			activeOutsideBufferRequestedScrollTopPx
		) =>
			sessionStore.viewport.setPendingOutsideBufferScrollTopPx(
				targetSessionId,
				pendingOutsideBufferScrollTopPx,
				activeOutsideBufferRequestedScrollTopPx
			),
		setLastOutsideBufferRecoveryDispatchMs: (
			targetSessionId,
			lastOutsideBufferRecoveryDispatchMs
		) =>
			sessionStore.viewport.setLastOutsideBufferRecoveryDispatchMs(
				targetSessionId,
				lastOutsideBufferRecoveryDispatchMs
			),
		setLastBottomRevealDispatchMs: (targetSessionId, lastBottomRevealDispatchMs) =>
			sessionStore.viewport.setLastBottomRevealDispatchMs(
				targetSessionId,
				lastBottomRevealDispatchMs
			),
		setPendingQueuedScrollIntentPx: (targetSessionId, pendingQueuedScrollIntentPx) =>
			sessionStore.viewport.setPendingQueuedScrollIntentPx(
				targetSessionId,
				pendingQueuedScrollIntentPx
			),
		clearOutsideBufferRecovery: (targetSessionId) =>
			sessionStore.viewport.clearOutsideBufferRecovery(targetSessionId),
		consumeScrollCorrectionPx: (targetSessionId) =>
			sessionStore.viewport.consumeScrollCorrectionPx(targetSessionId),
	},
	onNearBottomChange: (isNearBottom) => onNearBottomChange?.(isNearBottom),
	onNearTopChange: (isNearTop) => onNearTopChange?.(isNearTop),
	afterRender: () => tick(),
	requestAnimationFrame: (callback) => requestAnimationFrame(callback),
	nowMs: () => performance.now(),
});

function applyEnvelope(envelope: SessionStateEnvelope | null): void {
	if (sessionId === null || envelope === null) {
		return;
	}
	// Suppress late command-response payloads while a recovery episode is in
	// flight. The reset projection would otherwise accept this stale payload
	// (current === null) and undo the reattach. Event-stream payloads flow
	// through a separate path (live consumer -> applyBufferPush/Delta) and are
	// still accepted during recovery.
	if (sessionStore.viewport.getAttachmentStatus(sessionId) !== "attached") {
		return;
	}
	sessionStore.applySessionStateEnvelope(sessionId, envelope);
}

function extractViewportSessionNotAttached(
	error: AppError
): ViewportSessionNotAttachedAcpError | null {
	if (error.cause instanceof ViewportSessionNotAttachedAcpError) {
		return error.cause;
	}
	return null;
}

function handleDispatchError(error: AppError): void {
	const notAttached = extractViewportSessionNotAttached(error);
	if (notAttached !== null) {
		sessionStore.viewport.recoverAttachment(notAttached.sessionId);
	}
}

function isDispatchSuppressed(): boolean {
	return sessionId !== null && sessionStore.viewport.getAttachmentStatus(sessionId) !== "attached";
}

function nextViewportRequestGeneration(): number {
	return sessionStore.viewport.nextRequestGeneration(sessionId);
}

function handleScroll(event: Event): void {
	viewportAdapter.handleScroll(event);
}

function handleWheel(event: WheelEvent): void {
	viewportAdapter.handleWheel(event);
}

function bindScrollContainer(node: HTMLDivElement): { destroy: () => void } {
	return viewportAdapter.attachScrollContainer(node);
}

function observeViewport(node: HTMLDivElement): { destroy: () => void } {
	return viewportAdapter.observeViewport(node);
}

const confirmRowHeight = viewportAdapter.createConfirmRowHeightAction();

function latestVisibleUserRowId(): string | null {
	for (let index = bufferRows.length - 1; index >= 0; index -= 1) {
		const row = bufferRows[index];
		if (row?.kind === "user") {
			return row.rowId;
		}
	}
	return null;
}

// Bootstrap the buffer once per session: the live producer pushes the initial
// buffer on the open event stream, but a forced request guards a mount that
// races ahead of that push. Idempotent in the store (no-op if a buffer exists).
$effect(() => {
	if (sessionId === null || sessionId === bootstrappedSessionId) {
		return;
	}
	bootstrappedSessionId = sessionId;
	sessionStore.viewport.ensureBufferBootstrap(sessionId);
});

$effect(() => {
	sessionId;
	viewportAdapter.syncSessionOwner();
});

$effect(() => {
	const projection = bufferProjection;
	if (projection === null) {
		return;
	}
	projection.revision;
	viewportAdapter.flushPendingViewportHeight();
});

$effect(() => {
	const projection = bufferProjection;
	if (projection === null) {
		return;
	}
	const clientScroll = viewportClientScroll;
	projection.emissionSeq;
	projection.bufferEndIndex;
	projection.layoutRowCount;
	projection.mode.kind;
	clientScroll.pendingOutsideBufferScrollTopPx;
	clientScroll.activeOutsideBufferRequestedScrollTopPx;
	totalHeightPx;
	lastViewportHeightPx;
	viewportAdapter.reconcileRenderedProjection();
});

$effect(() => {
	const projection = bufferProjection;
	const clientScroll = viewportClientScroll;
	const requestedScrollTopPx =
		clientScroll.pendingOutsideBufferScrollTopPx ??
		clientScroll.activeOutsideBufferRequestedScrollTopPx;
	if (projection === null || requestedScrollTopPx === null || sessionId === null) {
		return;
	}
	projection.emissionSeq;
	clientScroll.activeOutsideBufferRequestedScrollTopPx;
	totalHeightPx;
	lastViewportHeightPx;
	viewportAdapter.reconcileOutsideBufferRequest();
});

// Apply a Rust-decided scroll position once per push that carries one (initial
// open, reveal, follow-tail). Keyed on emissionSeq so it fires exactly once per
// repositioning push and never fights native scrolling on plain refills.
$effect(() => {
	const projection = bufferProjection;
	if (projection === null) {
		return;
	}
	const target = projection.scrollTopTarget;
	if (target === null) {
		return;
	}
	projection.emissionSeq;
	viewportClientScroll.pendingOutsideBufferScrollTopPx;
	viewportAdapter.reconcileRustScrollTopTarget();
});

// Apply the Rust-decided RELATIVE scroll correction additively to the live
// scrollTop. Unlike the absolute target above, this never fights the user's
// live position: when heights ABOVE the anchor change (off-screen confirmations,
// prepend-on-scroll-up) content shifts under the viewport, and the canonical
// Δ_above (`scrollAnchorCorrectionPx`) compensates it exactly. Keyed on
// emissionSeq so it drains the coalescing-safe accumulator once per emission
// window — the accumulator (store-owned) sums corrections across a burst that
// collapses into a single Svelte flush, so no intermediate Δ is lost. The
// suppress guard ensures the programmatic adjustment never echoes a
// (non-canonical) scroll intent back to Rust.
$effect(() => {
	const projection = bufferProjection;
	if (projection === null || sessionId === null) {
		return;
	}
	projection.emissionSeq;
	viewportAdapter.reconcileScrollAnchorCorrection();
});

// Following-tail pin as a LOCAL invariant: when canonical layout grows during
// streaming, re-pin to the bottom after the new rows have rendered. Re-asserted
// only when totalHeightPx changes while in followingTail mode.
$effect(() => {
	const projection = bufferProjection;
	if (projection === null) {
		return;
	}
	projection.mode.kind;
	totalHeightPx;
	viewportAdapter.reconcileFollowingTailLayoutGrowth();
});

$effect(() => {
	if (pendingUserRevealRequestKey === null || pendingUserRevealRequestKey === consumedPendingUserRevealRequestKey) {
		return;
	}
	consumedPendingUserRevealRequestKey = pendingUserRevealRequestKey;
	viewportAdapter.dispatchRevealForRow(latestVisibleUserRowId());
});

export function scrollToBottom(_options?: { force?: boolean }) {
	viewportAdapter.scrollToBottom();
}

export function prepareForNextUserReveal(_options?: { force?: boolean }) {
	viewportAdapter.prepareForNextUserReveal(latestVisibleUserRowId());
}

export function scrollToTop() {
	viewportAdapter.scrollToTop();
}
</script>

<div use:observeViewport class="h-full min-h-0">
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

	<div
		use:bindScrollContainer
		data-testid="rust-transcript-viewport"
		data-buffer-start-index={bufferProjection?.bufferStartIndex}
		data-buffer-end-index={bufferProjection?.bufferEndIndex}
		data-buffer-layout-row-count={bufferProjection?.layoutRowCount}
		data-buffer-top-px={bufferProjection?.offsetsPx[0]}
		data-buffer-end-px={bufferProjection?.bufferEndOffsetPx}
		data-buffer-emission-seq={bufferProjection?.emissionSeq}
		data-buffer-mode={bufferProjection?.mode.kind}
		data-session-present={sessionId !== null}
		data-viewport-attachment-status={sessionStore.viewport.getAttachmentStatus(sessionId)}
		class="h-full min-h-0 overflow-y-auto"
		style="overflow-anchor: none;"
		onscroll={handleScroll}
		onwheel={handleWheel}
	>
		<div style={`height: ${totalHeightPx}px; position: relative; width: 100%;`}>
			<div
				style={`position: absolute; left: 0; top: 0; width: 100%; transform: translateY(${windowTopPx}px); display: flex; flex-direction: column;`}
			>
				<TranscriptViewportRowRenderer
					{renderedRows}
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
					{isPlanActionAvailable}
					getAttachedPermission={(targetSessionId, toolCallId) =>
						permissionStore.getForToolCall(targetSessionId, toolCallId)}
					{confirmRowHeight}
				/>
			</div>
		</div>
	</div>
</div>
