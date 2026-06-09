<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import { WaitingIndicator } from "../../waiting-indicator/index.js";
import { setIconConfig } from "@acepe/ui/icon-context";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelSceneEntryModel,
	AgentToolFileSelectEvent,
	AgentToolStatus,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import { setContext } from "svelte";
import { SESSION_CONTEXT_KEY_EXPORT } from "../../../hooks/use-session-context.js";
import type { BufferProjection } from "../../../store/transcript-viewport-store.svelte.js";
import type { TurnState } from "../../../store/types.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";
import type {
	OperationState,
	SessionStateEnvelope,
	TranscriptSegment,
	TranscriptViewportRow,
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
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import {
	accumulateQueuedScrollIntentAtEdge,
	detachedModeScrollTargetPx,
	isCanonicalBottomScrollIntent,
	outsideBufferScrollRecovery,
	selectPhysicalScrollCommand,
	shouldApplyPhysicalScrollCommand,
	shouldDispatchOutsideBufferRecovery,
	shouldDispatchTailDetachScrollIntent,
	shouldIgnoreStaleFollowingTailTarget,
	shouldPinHydratedFollowingTailProjection,
	shouldPinFollowingTailToRenderedBottom,
	shouldSuppressProgrammaticScrollEvent,
	semanticScrollIntentAtRenderedBufferEdge,
} from "../logic/transcript-viewport-scroll-controller.js";
import type {
	TranscriptViewportPhysicalScrollCommand,
	TranscriptViewportPhysicalScrollReason,
} from "../logic/transcript-viewport-scroll-controller.js";
import {
	confirmTranscriptViewportHeight,
	revealTranscriptViewportRow,
	resizeTranscriptViewport,
	scrollTranscriptViewport,
} from "../../../session-state/session-state-viewport-command-service.js";
import { useTheme } from "../../../../components/theme/context.svelte.js";
import { tick } from "svelte";

const NEAR_EDGE_THRESHOLD_PX = 24;
// Refill when the visible range comes within roughly one screen of a buffered
// edge that is not also the layout extreme, so a fresh slice lands before the
// user scrolls into unbuffered space.
const REFILL_THRESHOLD_PX = 800;
const OUTSIDE_BUFFER_RECOVERY_FRAME_LIMIT = 240;
const OUTSIDE_BUFFER_RECOVERY_RETRY_MS = 750;
const BOTTOM_PIN_RECOVERY_FRAME_LIMIT = 24;
const BOTTOM_REVEAL_RETRY_MS = 750;
const EMPTY_SCENE_ENTRIES: readonly AgentPanelSceneEntryModel[] = [];

type PendingHeightConfirmation = {
	readonly row: TranscriptViewportRow;
	readonly heightPx: number;
	readonly sessionId: string;
};

type SceneContentViewportProps = {
	panelId: string;
	sceneEntries?: readonly AgentPanelSceneEntryModel[];
	bufferProjection?: BufferProjection | null;
	turnState: TurnState;
	isWaitingForResponse: boolean;
	waitingLabel?: string | null;
	projectPath: string | undefined;
	sessionId: string | null;
	pendingUserRevealRequestKey?: string | null;
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
	isWaitingForResponse,
	waitingLabel: _waitingLabel = null,
	projectPath,
	sessionId,
	pendingUserRevealRequestKey = null,
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

let viewportRef: HTMLDivElement | null = $state(null);
let scrollContainerRef: HTMLDivElement | null = $state(null);
let lastViewportHeightPx = $state(720);
let pendingViewportHeightPx = $state<number | null>(null);
let consumedPendingUserRevealRequestKey = $state<string | null>(null);
let bootstrappedSessionId: string | null = null;
let lastAppliedScrollEmissionSeq = -1;
let lastAppliedCorrectionEmissionSeq = -1;
let lastFollowTailTotalHeightPx = -1;
let suppressedProgrammaticScrollTopPx: number | null = null;
let scrollIntentRafPending = false;
let locallyDetachedFromTail = false;
let locallyPinnedToTop = false;
let locallyPinnedToBottom = false;
let pendingOutsideBufferScrollTopPx: number | null = null;
let activeOutsideBufferRequestedScrollTopPx: number | null = null;
let lastOutsideBufferRecoveryDispatchMs: number | null = null;
let lastBottomRevealDispatchMs: number | null = null;
let outsideBufferRecoveryRafPending = false;
let outsideBufferRecoveryFramesRemaining = 0;
let bottomPinRecoveryRafPending = false;
let bottomPinRecoveryFramesRemaining = 0;
let bottomJumpPinRequested = false;
let pendingQueuedScrollIntentPx: number | null = null;
let queuedScrollIntentRafPending = false;
let queuedScrollIntentInFlight = false;
let physicalScrollRafPending = false;
let pendingPhysicalScrollCommand: TranscriptViewportPhysicalScrollCommand | null = null;
let heightConfirmationRafPending = false;
let heightConfirmationOwnerSessionId: string | null = null;
const pendingHeightConfirmations = new Map<string, PendingHeightConfirmation>();
const queuedHeightByRowVersion = new Map<string, number>();
const heightMeasurementKeyByRowId = new Map<string, string>();

const sceneEntryById = $derived.by(() => {
	const index = new Map<string, AgentPanelSceneEntryModel>();
	for (const entry of sceneEntries ?? EMPTY_SCENE_ENTRIES) {
		index.set(entry.id, entry);
	}
	return index;
});

const bufferRows = $derived(bufferProjection?.rows ?? []);
const renderedRows = $derived.by(() => {
	const startIndex = bufferProjection?.bufferStartIndex ?? 0;
	const offsets = bufferProjection?.offsetsPx ?? [];
	return bufferRows.map((row, index) => {
		return {
			row,
			index: startIndex + index,
			offsetPx: offsets[index] ?? 0,
			entry: resolveSceneEntry(row),
		};
	});
});

const totalHeightPx = $derived(bufferProjection?.totalHeightPx ?? 0);

// Anchor for the flow-layout window: the canonical top of the first buffered
// row. Rows below it flow naturally (block/flex column) so intra-window layout
// can never overlap or gap regardless of estimate-vs-actual height drift.
// Canonical offsets still own the scrollbar (totalHeightPx) and refill math.
const windowTopPx = $derived(renderedRows[0]?.offsetPx ?? 0);

function segmentText(segments: readonly TranscriptSegment[]): string {
	let text = "";
	for (const segment of segments) {
		text += segment.text;
	}
	return text;
}

function resolveSceneEntry(row: TranscriptViewportRow): AgentPanelSceneEntryModel {
	const canonicalEntry = sceneEntryById.get(row.sourceEntryId);
	if (canonicalEntry !== undefined) {
		return canonicalEntry;
	}

	if (row.content.kind === "transcript" && row.content.role === "user") {
		return {
			id: row.sourceEntryId,
			type: "user",
			text: segmentText(row.content.segments),
		};
	}

	if (row.content.kind === "transcript" && row.content.role === "assistant") {
		return {
			id: row.sourceEntryId,
			type: "assistant",
			markdown: segmentText(row.content.segments.filter((segment) => segment.kind === "text")),
			message: {
				chunks: row.content.segments.map((segment) => {
					return {
						type: segment.kind === "thought" ? "thought" : "message",
						block: {
							type: "text",
							text: segment.text,
						},
					};
				}),
			},
			isStreaming: row.activeStreamingTail !== null,
		};
	}

	const operation = row.operationLinks[0];
	return {
		id: row.sourceEntryId,
		type: "tool_call",
		toolCallId: operation?.toolCallId,
		operationId: operation?.operationId,
		kind: "other",
		title: operation?.name ?? (row.kind === "error" ? "Error" : "Tool"),
		status: operation === undefined ? "degraded" : toolStatusFromOperationState(operation.state),
		presentationState: operation === undefined ? "degraded_operation" : "resolved",
		degradedReason: operation === undefined ? "Viewport row has no linked operation." : null,
		resultText: row.content.kind === "transcript" ? segmentText(row.content.segments) : null,
	};
}

function toolStatusFromOperationState(state: OperationState): AgentToolStatus {
	if (state === "running") {
		return "running";
	}
	if (state === "completed") {
		return "done";
	}
	if (state === "failed") {
		return "error";
	}
	if (state === "blocked") {
		return "blocked";
	}
	if (state === "cancelled") {
		return "cancelled";
	}
	if (state === "degraded") {
		return "degraded";
	}
	return "pending";
}

function revisionInput() {
	return bufferProjection?.revision ?? null;
}

function applyEnvelope(envelope: SessionStateEnvelope | null): void {
	if (sessionId === null || envelope === null) {
		return;
	}
	// Suppress late command-response payloads while a recovery episode is in
	// flight. The reset projection would otherwise accept this stale payload
	// (current === null) and undo the reattach. Event-stream payloads flow
	// through a separate path (live consumer -> applyBufferPush/Delta) and are
	// still accepted during recovery.
	if (sessionStore.getViewportAttachmentStatus(sessionId) !== "attached") {
		return;
	}
	sessionStore.applySessionStateEnvelope(sessionId, envelope);
}

function extractViewportSessionNotAttached(
	error: unknown
): ViewportSessionNotAttachedAcpError | null {
	if (error instanceof ViewportSessionNotAttachedAcpError) {
		return error;
	}
	if (
		error !== null &&
		typeof error === "object" &&
		"cause" in error &&
		error.cause instanceof ViewportSessionNotAttachedAcpError
	) {
		return error.cause;
	}
	return null;
}

function handleDispatchError(error: unknown): void {
	const notAttached = extractViewportSessionNotAttached(error);
	if (notAttached !== null) {
		sessionStore.recoverViewportAttachment(notAttached.sessionId);
	}
}

function isDispatchSuppressed(): boolean {
	return sessionId !== null && sessionStore.getViewportAttachmentStatus(sessionId) !== "attached";
}

function nextViewportRequestGeneration(): number {
	return sessionStore.nextViewportRequestGeneration(sessionId);
}

function dispatchScrollIntent(
	offsetPx: number,
	options?: { readonly forceFresh?: boolean }
): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	scrollTranscriptViewport({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		offsetPx,
		requestGeneration: nextViewportRequestGeneration(),
		forceFresh: options?.forceFresh ?? false,
	}).match(applyEnvelope, handleDispatchError);
}

function queueScrollIntent(offsetPx: number): void {
	pendingQueuedScrollIntentPx = Math.max(0, Math.round(offsetPx));
	scheduleQueuedScrollIntent();
}

function scheduleQueuedScrollIntent(): void {
	if (queuedScrollIntentRafPending) {
		return;
	}
	queuedScrollIntentRafPending = true;
	requestAnimationFrame(flushQueuedScrollIntent);
}

function flushQueuedScrollIntent(): void {
	queuedScrollIntentRafPending = false;
	if (queuedScrollIntentInFlight) {
		return;
	}
	const nextOffsetPx = pendingQueuedScrollIntentPx;
	pendingQueuedScrollIntentPx = null;
	if (nextOffsetPx === null) {
		return;
	}
	dispatchQueuedScrollIntent(nextOffsetPx);
}

function completeQueuedScrollIntent(): void {
	queuedScrollIntentInFlight = false;
	if (pendingQueuedScrollIntentPx !== null) {
		scheduleQueuedScrollIntent();
	}
}

function dispatchQueuedScrollIntent(offsetPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	queuedScrollIntentInFlight = true;
	scrollTranscriptViewport({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		offsetPx,
		requestGeneration: nextViewportRequestGeneration(),
	}).match(
		(envelope) => {
			applyEnvelope(envelope);
			completeQueuedScrollIntent();
		},
		(error) => {
			handleDispatchError(error);
			completeQueuedScrollIntent();
		}
	);
}

function dispatchRevealIntent(rowId: string | null): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	revealTranscriptViewportRow({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		rowId,
		requestGeneration: nextViewportRequestGeneration(),
	}).match(applyEnvelope, handleDispatchError);
}

function dispatchBottomRevealIntent(): void {
	const nowMs = performance.now();
	if (
		lastBottomRevealDispatchMs !== null &&
		nowMs - lastBottomRevealDispatchMs < BOTTOM_REVEAL_RETRY_MS
	) {
		return;
	}
	lastBottomRevealDispatchMs = nowMs;
	dispatchRevealIntent(null);
}

function dispatchResizeIntent(heightPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		pendingViewportHeightPx = heightPx;
		return;
	}
	resizeTranscriptViewport({
		sessionId,
		revision,
		viewportHeightPx: heightPx,
		requestGeneration: nextViewportRequestGeneration(),
	}).match(applyEnvelope, handleDispatchError);
}

function dispatchHeightConfirmation(row: TranscriptViewportRow, heightPx: number): void {
	const revision = revisionInput();
	if (sessionId === null || revision === null || isDispatchSuppressed()) {
		return;
	}
	const viewportOffsetPx = locallyPinnedToTop ? 0 : liveDetachedViewportOffsetPx();
	confirmTranscriptViewportHeight({
		sessionId,
		revision,
		viewportHeightPx: lastViewportHeightPx,
		rowId: row.rowId,
		rowVersion: row.version,
		heightPx,
		viewportOffsetPx,
		requestGeneration: nextViewportRequestGeneration(),
	}).match(applyEnvelope, handleDispatchError);
}

function scheduleHeightConfirmation(row: TranscriptViewportRow, heightPx: number): void {
	if (sessionId === null) {
		return;
	}
	if (heightConfirmationOwnerSessionId !== sessionId) {
		pendingHeightConfirmations.clear();
		queuedHeightByRowVersion.clear();
		heightMeasurementKeyByRowId.clear();
		heightConfirmationOwnerSessionId = sessionId;
	}
	const measurementKey = `${row.rowId}:${row.version}`;
	if (queuedHeightByRowVersion.get(measurementKey) === heightPx) {
		return;
	}
	const previousKey = heightMeasurementKeyByRowId.get(row.rowId);
	if (previousKey !== undefined && previousKey !== measurementKey) {
		queuedHeightByRowVersion.delete(previousKey);
	}
	heightMeasurementKeyByRowId.set(row.rowId, measurementKey);
	queuedHeightByRowVersion.set(measurementKey, heightPx);
	pendingHeightConfirmations.set(row.rowId, { row, heightPx, sessionId });
	if (heightConfirmationRafPending) {
		return;
	}
	heightConfirmationRafPending = true;
	requestAnimationFrame(flushNextHeightConfirmation);
}

function flushNextHeightConfirmation(): void {
	heightConfirmationRafPending = false;
	const next = pendingHeightConfirmations.entries().next();
	if (next.done) {
		return;
	}
	const [rowId, confirmation] = next.value;
	pendingHeightConfirmations.delete(rowId);
	if (confirmation.sessionId === sessionId) {
		dispatchHeightConfirmation(confirmation.row, confirmation.heightPx);
	}
	if (pendingHeightConfirmations.size > 0) {
		heightConfirmationRafPending = true;
		requestAnimationFrame(flushNextHeightConfirmation);
	}
}

function isRowNearLiveViewport(node: HTMLElement): boolean {
	if (scrollContainerRef === null) {
		return true;
	}
	const rowRect = node.getBoundingClientRect();
	const viewportRect = scrollContainerRef.getBoundingClientRect();
	const marginPx = Math.max(lastViewportHeightPx, REFILL_THRESHOLD_PX);
	return rowRect.bottom >= viewportRect.top - marginPx && rowRect.top <= viewportRect.bottom + marginPx;
}

function scheduleVisibleHeightConfirmations(): void {
	if (scrollContainerRef === null) {
		return;
	}
	const rowById = new Map<string, TranscriptViewportRow>();
	for (const row of bufferRows) {
		rowById.set(row.rowId, row);
	}
	for (const node of scrollContainerRef.querySelectorAll<HTMLElement>("[data-entry-key]")) {
		if (!isRowNearLiveViewport(node)) {
			continue;
		}
		const rowId = node.getAttribute("data-entry-key");
		if (rowId === null) {
			continue;
		}
		const row = rowById.get(rowId);
		if (row === undefined) {
			continue;
		}
		const heightPx = Math.max(0, Math.round(node.getBoundingClientRect().height));
		if (heightPx > 0) {
			scheduleHeightConfirmation(row, heightPx);
		}
	}
}

function liveDetachedViewportOffsetPx(): number | null {
	if (scrollContainerRef === null) {
		return null;
	}
	if (isLiveViewportNearBottom()) {
		return null;
	}
	return Math.max(0, Math.round(scrollContainerRef.scrollTop));
}

function isLiveViewportNearBottom(): boolean {
	if (scrollContainerRef === null) {
		return true;
	}
	const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
	return maxTop - scrollContainerRef.scrollTop <= NEAR_EDGE_THRESHOLD_PX;
}

function renderedBottomScrollTargetPx(): number | null {
	if (scrollContainerRef === null) {
		return null;
	}
	const rows = scrollContainerRef.querySelectorAll<HTMLElement>("[data-entry-key]");
	const lastRow = rows.item(rows.length - 1);
	if (lastRow === null) {
		return null;
	}
	const viewportRect = scrollContainerRef.getBoundingClientRect();
	const lastRowRect = lastRow.getBoundingClientRect();
	const renderedBottomPx = Math.max(
		0,
		Math.round(lastRowRect.bottom - viewportRect.top + scrollContainerRef.scrollTop)
	);
	return Math.max(0, renderedBottomPx - scrollContainerRef.clientHeight);
}

function viewportHasVisibleRows(): boolean {
	if (scrollContainerRef === null) {
		return true;
	}
	const viewportRect = scrollContainerRef.getBoundingClientRect();
	for (const row of scrollContainerRef.querySelectorAll<HTMLElement>("[data-entry-key]")) {
		const rowRect = row.getBoundingClientRect();
		if (rowRect.bottom > viewportRect.top && rowRect.top < viewportRect.bottom) {
			return true;
		}
	}
	return false;
}

function queuePhysicalScrollCommand(
	reason: TranscriptViewportPhysicalScrollReason,
	targetScrollTopPx: number,
	timing: "frame" | "immediate" = "frame"
): void {
	const candidate: TranscriptViewportPhysicalScrollCommand = {
		kind: "physicalScroll",
		reason,
		targetScrollTopPx,
		suppressScrollEvent: true,
	};
	pendingPhysicalScrollCommand = selectPhysicalScrollCommand({
		current: pendingPhysicalScrollCommand,
		candidate,
	});
	if (timing === "immediate") {
		flushPhysicalScrollCommand();
		return;
	}
	if (physicalScrollRafPending) {
		return;
	}
	physicalScrollRafPending = true;
	requestAnimationFrame(flushPhysicalScrollCommand);
}

function flushPhysicalScrollCommand(): void {
	physicalScrollRafPending = false;
	const command = pendingPhysicalScrollCommand;
	pendingPhysicalScrollCommand = null;
	if (command === null) {
		return;
	}
	applyViewportScrollCommand(command);
}

function applyViewportScrollCommand(command: TranscriptViewportPhysicalScrollCommand): void {
	if (scrollContainerRef === null) {
		return;
	}
	const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
	const target = Math.min(maxTop, Math.max(0, command.targetScrollTopPx));
	if (
		!shouldApplyPhysicalScrollCommand({
			currentScrollTopPx: scrollContainerRef.scrollTop,
			targetScrollTopPx: target,
			thresholdPx: 1,
		})
	) {
		updateEdgeFlags(target);
		return;
	}
	if (command.suppressScrollEvent) {
		suppressedProgrammaticScrollTopPx = target;
	}
	scrollContainerRef.scrollTop = target;
	updateEdgeFlags(target);
}

function restoreDetachedScrollTargetIfOutsideBuffer(): boolean {
	const projection = bufferProjection;
	if (
		scrollContainerRef === null ||
		projection === null ||
		sessionId === null ||
		pendingOutsideBufferScrollTopPx !== null
	) {
		return false;
	}
	const scrollTopPx = Math.max(0, Math.round(scrollContainerRef.scrollTop));
	const outsideBuffer = sessionStore.viewportIsOutsideBuffer(
		sessionId,
		scrollTopPx,
		lastViewportHeightPx
	);
	if (!outsideBuffer && viewportHasVisibleRows()) {
		return false;
	}
	const target = detachedModeScrollTargetPx({
		mode: projection.mode,
		rows: projection.rows,
		offsetsPx: projection.offsetsPx,
	});
	if (target === null) {
		return false;
	}
	const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
	const next = Math.min(maxTop, target);
	if (Math.abs(scrollContainerRef.scrollTop - next) > 1) {
		queuePhysicalScrollCommand("detachedRestore", next);
	}
	updateEdgeFlags(next);
	return true;
}

function clampLiveScrollTopIntoRenderedBuffer(): boolean {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null || projection.offsetsPx.length === 0) {
		return false;
	}
	const current = Math.max(0, Math.round(scrollContainerRef.scrollTop));
	const bufferTopPx = projection.offsetsPx[0] ?? 0;
	if (locallyPinnedToTop && projection.bufferStartIndex === 0) {
		queuePhysicalScrollCommand("resolvedOutsideBufferTarget", 0, "immediate");
		return true;
	}
	if (viewportHasVisibleRows()) {
		return false;
	}
	const canonicalBufferBottomPx = Math.max(
		bufferTopPx,
		projection.bufferEndOffsetPx - lastViewportHeightPx
	);
	const renderedBufferBottomPx = renderedBottomScrollTargetPx();
	const bufferBottomPx =
		renderedBufferBottomPx === null
			? canonicalBufferBottomPx
			: Math.max(bufferTopPx, Math.min(canonicalBufferBottomPx, renderedBufferBottomPx));
	const target = current < bufferTopPx ? bufferTopPx : bufferBottomPx;
	queuePhysicalScrollCommand("outsideBufferClamp", target, "immediate");
	return true;
}

function pinLiveScrollTopToRenderedBottom(): boolean {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null) {
		return false;
	}
	const renderedTarget = renderedBottomScrollTargetPx();
	const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
	const target = Math.min(maxTop, renderedTarget ?? maxTop);
	queuePhysicalScrollCommand("followTailRenderedBottom", target, "immediate");
	return true;
}

function scheduleBottomPinRecovery(resetFrameBudget = true): void {
	if (resetFrameBudget) {
		bottomPinRecoveryFramesRemaining = BOTTOM_PIN_RECOVERY_FRAME_LIMIT;
	}
	if (bottomPinRecoveryRafPending) {
		return;
	}
	bottomPinRecoveryRafPending = true;
	requestAnimationFrame(() => {
		bottomPinRecoveryRafPending = false;
		if (
			(!locallyPinnedToBottom && !bottomJumpPinRequested) ||
			bottomPinRecoveryFramesRemaining <= 0
		) {
			bottomPinRecoveryFramesRemaining = 0;
			return;
		}
		bottomPinRecoveryFramesRemaining -= 1;
		if (
			bottomJumpPinRequested &&
			bufferProjection !== null &&
			bufferProjection.bufferEndIndex < bufferProjection.layoutRowCount
		) {
			scheduleBottomPinRecovery(false);
			return;
		}
		pinLiveScrollTopToRenderedBottom();
		if (
			bottomJumpPinRequested &&
			bufferProjection !== null &&
			bufferProjection.bufferEndIndex >= bufferProjection.layoutRowCount
		) {
			bottomJumpPinRequested = false;
		}
		scheduleBottomPinRecovery(false);
	});
}

function recoverOutsideBufferScrollTop(
	observedScrollTopPx: number,
	resetFrameBudget = true
): boolean {
	if (scrollContainerRef === null || bufferProjection === null || bufferProjection.offsetsPx.length === 0) {
		return false;
	}
	const bufferTopPx = bufferProjection.offsetsPx[0] ?? 0;
	const recovery = outsideBufferScrollRecovery({
		observedScrollTopPx,
		pendingRequestedScrollTopPx: pendingOutsideBufferScrollTopPx,
		viewportHeightPx: lastViewportHeightPx,
		bufferTopPx,
		bufferEndOffsetPx: bufferProjection.bufferEndOffsetPx,
	});
	if (recovery === null) {
		return false;
	}
	const nowMs = performance.now();
	const shouldDispatch = shouldDispatchOutsideBufferRecovery({
		pendingRequestedScrollTopPx: pendingOutsideBufferScrollTopPx,
		requestedScrollTopPx: recovery.requestedScrollTopPx,
		lastDispatchMs: lastOutsideBufferRecoveryDispatchMs,
		nowMs,
		retryIntervalMs: OUTSIDE_BUFFER_RECOVERY_RETRY_MS,
	});
	pendingOutsideBufferScrollTopPx = recovery.requestedScrollTopPx;
	activeOutsideBufferRequestedScrollTopPx = recovery.requestedScrollTopPx;
	if (recovery.requestedScrollTopPx <= NEAR_EDGE_THRESHOLD_PX) {
		locallyPinnedToTop = true;
		locallyPinnedToBottom = false;
		bottomPinRecoveryFramesRemaining = 0;
	}
	if (
		isCanonicalBottomScrollIntent({
			requestedScrollTopPx: recovery.requestedScrollTopPx,
			totalHeightPx,
			viewportHeightPx: lastViewportHeightPx,
			thresholdPx: NEAR_EDGE_THRESHOLD_PX,
		})
	) {
		locallyPinnedToTop = false;
		locallyPinnedToBottom = true;
		bottomJumpPinRequested = true;
		scheduleBottomPinRecovery();
	}
	if (resetFrameBudget) {
		outsideBufferRecoveryFramesRemaining = OUTSIDE_BUFFER_RECOVERY_FRAME_LIMIT;
	}
	if (Math.abs(recovery.clampedScrollTopPx - scrollContainerRef.scrollTop) > 1) {
		queuePhysicalScrollCommand("outsideBufferClamp", recovery.clampedScrollTopPx, "immediate");
	}
		if (shouldDispatch) {
			lastOutsideBufferRecoveryDispatchMs = nowMs;
			dispatchScrollIntent(recovery.requestedScrollTopPx, { forceFresh: true });
		}
	scheduleOutsideBufferRecovery();
	return true;
}

function scheduleOutsideBufferRecovery(): void {
	if (outsideBufferRecoveryRafPending) {
		return;
	}
	outsideBufferRecoveryRafPending = true;
	requestAnimationFrame(() => {
		outsideBufferRecoveryRafPending = false;
		if (scrollContainerRef === null || sessionId === null) {
			outsideBufferRecoveryFramesRemaining = 0;
			return;
		}
		if (outsideBufferRecoveryFramesRemaining <= 0) {
			return;
		}
		outsideBufferRecoveryFramesRemaining -= 1;
		const observedScrollTopPx = Math.max(0, Math.round(scrollContainerRef.scrollTop));
		const recoveryScrollTopPx = pendingOutsideBufferScrollTopPx ?? observedScrollTopPx;
		const recovered = recoverOutsideBufferScrollTop(recoveryScrollTopPx, false);
		if (!recovered && pendingOutsideBufferScrollTopPx !== null) {
			scheduleOutsideBufferRecovery();
		}
	});
}

function handleScroll(event: Event): void {
	if (!(event.currentTarget instanceof HTMLDivElement)) {
		return;
	}
	const offsetPx = event.currentTarget.scrollTop;
	updateEdgeFlags(offsetPx);
	const liveNearBottomNow = isLiveViewportNearBottom();
	if (liveNearBottomNow) {
		locallyPinnedToTop = false;
		locallyPinnedToBottom = true;
		scheduleBottomPinRecovery();
		if (
			activeOutsideBufferRequestedScrollTopPx !== null &&
			activeOutsideBufferRequestedScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
		) {
			activeOutsideBufferRequestedScrollTopPx = null;
		}
		if (
			pendingOutsideBufferScrollTopPx !== null &&
			pendingOutsideBufferScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
		) {
			pendingOutsideBufferScrollTopPx = null;
		}
		if (
			pendingPhysicalScrollCommand?.reason === "resolvedOutsideBufferTarget" &&
			pendingPhysicalScrollCommand.targetScrollTopPx <= NEAR_EDGE_THRESHOLD_PX
		) {
			pendingPhysicalScrollCommand = null;
		}
	}
	if (
		shouldSuppressProgrammaticScrollEvent({
			expectedScrollTopPx: suppressedProgrammaticScrollTopPx,
			observedScrollTopPx: offsetPx,
		})
	) {
		suppressedProgrammaticScrollTopPx = null;
		return;
	}
	suppressedProgrammaticScrollTopPx = null;
	const immediateScrollTopPx = Math.max(0, Math.round(offsetPx));
	if (liveNearBottomNow) {
		dispatchBottomRevealIntent();
	}
	if (immediateScrollTopPx <= NEAR_EDGE_THRESHOLD_PX) {
		locallyPinnedToTop = true;
		locallyPinnedToBottom = false;
		bottomJumpPinRequested = false;
		bottomPinRecoveryFramesRemaining = 0;
	}
	if (sessionId !== null && recoverOutsideBufferScrollTop(immediateScrollTopPx)) {
		return;
	}
		if (clampLiveScrollTopIntoRenderedBuffer()) {
			if (sessionId !== null) {
				dispatchScrollIntent(immediateScrollTopPx, { forceFresh: true });
			}
			return;
	}
	if (scrollIntentRafPending) {
		return;
	}
	scrollIntentRafPending = true;
	requestAnimationFrame(() => {
		scrollIntentRafPending = false;
		if (scrollContainerRef === null || sessionId === null) {
			return;
		}
		const scrollTopPx = Math.max(0, Math.round(scrollContainerRef.scrollTop));
		if (pendingOutsideBufferScrollTopPx !== null) {
			scheduleOutsideBufferRecovery();
			return;
		}
		if (clampLiveScrollTopIntoRenderedBuffer()) {
			return;
		}
		const liveNearBottom = isLiveViewportNearBottom();
		if (liveNearBottom) {
			locallyDetachedFromTail = false;
		}
		if (
			shouldDispatchTailDetachScrollIntent({
				modeKind: bufferProjection?.mode.kind ?? "detached",
				liveNearBottom,
				alreadyLocallyDetached: locallyDetachedFromTail,
			})
		) {
			locallyDetachedFromTail = true;
			dispatchScrollIntent(scrollTopPx);
			return;
		}
		// Native scroll already moved the buffered rows under the viewport at no
		// JS cost. Only round-trip to Rust when the visible range is leaving the
		// buffered span (jump scroll) or approaching a non-extreme edge (refill).
		const outside = sessionStore.viewportIsOutsideBuffer(
			sessionId,
			scrollTopPx,
			lastViewportHeightPx
		);
		const needsRefill = sessionStore.viewportNeedsRefill(
			sessionId,
			scrollTopPx,
			lastViewportHeightPx,
			REFILL_THRESHOLD_PX
		);
		if (outside) {
			recoverOutsideBufferScrollTop(scrollTopPx);
			return;
		}
		if (needsRefill) {
			dispatchScrollIntent(scrollTopPx);
		}
	});
}

function handleWheel(event: WheelEvent): void {
	if (event.deltaY > 0) {
		locallyPinnedToTop = false;
		if (
			scrollContainerRef !== null &&
			sessionId !== null &&
			bufferProjection !== null &&
			bufferProjection.bufferEndIndex < bufferProjection.layoutRowCount
		) {
			const current = Math.max(0, Math.round(scrollContainerRef.scrollTop));
			const target = semanticScrollIntentAtRenderedBufferEdge({
				direction: "down",
				currentScrollTopPx: current,
				renderedBottomTargetPx: renderedBottomScrollTargetPx(),
				bufferTopPx: bufferProjection.offsetsPx[0] ?? 0,
				bufferStartIndex: bufferProjection.bufferStartIndex,
				bufferEndIndex: bufferProjection.bufferEndIndex,
				layoutRowCount: bufferProjection.layoutRowCount,
				viewportHeightPx: lastViewportHeightPx,
				wheelDeltaYPx: event.deltaY,
				totalHeightPx,
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			});
			if (target !== null) {
				event.preventDefault();
				queueScrollIntent(
					accumulateQueuedScrollIntentAtEdge({
						direction: "down",
						queuedScrollIntentPx: pendingQueuedScrollIntentPx,
						nextScrollIntentPx: target,
						viewportHeightPx: lastViewportHeightPx,
						wheelDeltaYPx: event.deltaY,
						totalHeightPx,
					})
				);
			}
		}
	}
	if (event.deltaY < 0) {
		locallyPinnedToBottom = false;
		bottomJumpPinRequested = false;
		bottomPinRecoveryFramesRemaining = 0;
		if (
			scrollContainerRef !== null &&
			sessionId !== null &&
			bufferProjection !== null &&
			bufferProjection.bufferStartIndex > 0
		) {
			const current = Math.max(0, Math.round(scrollContainerRef.scrollTop));
			const target = semanticScrollIntentAtRenderedBufferEdge({
				direction: "up",
				currentScrollTopPx: current,
				renderedBottomTargetPx: renderedBottomScrollTargetPx(),
				bufferTopPx: bufferProjection.offsetsPx[0] ?? 0,
				bufferStartIndex: bufferProjection.bufferStartIndex,
				bufferEndIndex: bufferProjection.bufferEndIndex,
				layoutRowCount: bufferProjection.layoutRowCount,
				viewportHeightPx: lastViewportHeightPx,
				wheelDeltaYPx: event.deltaY,
				totalHeightPx,
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			});
			if (target !== null) {
				event.preventDefault();
				queueScrollIntent(
					accumulateQueuedScrollIntentAtEdge({
						direction: "up",
						queuedScrollIntentPx: pendingQueuedScrollIntentPx,
						nextScrollIntentPx: target,
						viewportHeightPx: lastViewportHeightPx,
						wheelDeltaYPx: event.deltaY,
						totalHeightPx,
					})
				);
			}
		}
	}
}

function updateEdgeFlags(scrollTopPx: number): void {
	if (bufferProjection === null) {
		return;
	}
	const atLayoutTop =
		bufferProjection.bufferStartIndex === 0 && scrollTopPx <= NEAR_EDGE_THRESHOLD_PX;
	onNearTopChange?.(atLayoutTop);
	const atLayoutBottom =
		bufferProjection.bufferEndIndex >= bufferProjection.layoutRowCount &&
		totalHeightPx - lastViewportHeightPx - scrollTopPx <= NEAR_EDGE_THRESHOLD_PX;
	onNearBottomChange?.(atLayoutBottom || bufferProjection.mode.kind === "followingTail");
}

function observeViewport(node: HTMLDivElement): { destroy: () => void } {
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry === undefined) {
			return;
		}
		const heightPx = Math.max(0, Math.round(entry.contentRect.height));
		if (heightPx === lastViewportHeightPx) {
			return;
		}
		lastViewportHeightPx = heightPx;
		dispatchResizeIntent(heightPx);
	});
	observer.observe(node);
	return {
		destroy() {
			observer.disconnect();
		},
	};
}

function confirmRowHeight(node: HTMLDivElement, row: TranscriptViewportRow): { update: (nextRow: TranscriptViewportRow) => void; destroy: () => void } {
	let currentRow = row;
	let lastHeightPx = 0;
	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry === undefined) {
			return;
		}
		const heightPx = Math.max(0, Math.round(entry.contentRect.height));
		if (heightPx === lastHeightPx) {
			return;
		}
		lastHeightPx = heightPx;
		if (!isRowNearLiveViewport(node)) {
			return;
		}
		scheduleHeightConfirmation(currentRow, heightPx);
	});
	observer.observe(node);
	return {
		update(nextRow) {
			const measurementIdentityChanged =
				nextRow.rowId !== currentRow.rowId || nextRow.version !== currentRow.version;
			currentRow = nextRow;
			if (measurementIdentityChanged) {
				lastHeightPx = 0;
			}
		},
		destroy() {
			observer.disconnect();
		},
	};
}

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
	sessionStore.ensureViewportBufferBootstrap(sessionId);
});

$effect(() => {
	if (bufferProjection === null || pendingViewportHeightPx === null) {
		return;
	}
	const heightPx = pendingViewportHeightPx;
	pendingViewportHeightPx = null;
	dispatchResizeIntent(heightPx);
});

$effect(() => {
	const projection = bufferProjection;
	if (projection === null) {
		return;
	}
	const requestedScrollTopPx =
		pendingOutsideBufferScrollTopPx ?? activeOutsideBufferRequestedScrollTopPx;
	const shouldPinBottomAfterRenderedRecovery =
		requestedScrollTopPx !== null &&
		projection.bufferEndIndex >= projection.layoutRowCount &&
		isCanonicalBottomScrollIntent({
			requestedScrollTopPx,
			totalHeightPx,
			viewportHeightPx: lastViewportHeightPx,
			thresholdPx: NEAR_EDGE_THRESHOLD_PX,
		});
	projection.emissionSeq;
	void tick().then(() => {
		if (
			locallyPinnedToTop &&
			scrollContainerRef !== null &&
			projection.bufferStartIndex === 0
		) {
			queuePhysicalScrollCommand("resolvedOutsideBufferTarget", 0, "immediate");
			scheduleVisibleHeightConfirmations();
			return;
		}
			if ((locallyPinnedToBottom || shouldPinBottomAfterRenderedRecovery) && pinLiveScrollTopToRenderedBottom()) {
				scheduleBottomPinRecovery();
				scheduleVisibleHeightConfirmations();
				return;
			}
		if (
			shouldPinHydratedFollowingTailProjection({
				modeKind: projection.mode.kind,
				bufferEndIndex: projection.bufferEndIndex,
				layoutRowCount: projection.layoutRowCount,
				locallyDetachedFromTail,
			}) &&
			pinLiveScrollTopToRenderedBottom()
		) {
			locallyPinnedToBottom = true;
			scheduleBottomPinRecovery();
			scheduleVisibleHeightConfirmations();
			return;
		}
		if (!clampLiveScrollTopIntoRenderedBuffer()) {
			restoreDetachedScrollTargetIfOutsideBuffer();
		}
		scheduleVisibleHeightConfirmations();
	});
});

$effect(() => {
	const projection = bufferProjection;
	const requestedScrollTopPx =
		pendingOutsideBufferScrollTopPx ?? activeOutsideBufferRequestedScrollTopPx;
	if (projection === null || requestedScrollTopPx === null || sessionId === null) {
		return;
	}
	projection.emissionSeq;
	void tick().then(() => {
		if (
			scrollContainerRef === null ||
			sessionId === null ||
			activeOutsideBufferRequestedScrollTopPx === null ||
			sessionStore.viewportIsOutsideBuffer(sessionId, requestedScrollTopPx, lastViewportHeightPx)
		) {
			scheduleOutsideBufferRecovery();
			return;
		}
		if (Math.abs(scrollContainerRef.scrollTop - requestedScrollTopPx) <= 1) {
			pendingOutsideBufferScrollTopPx = null;
			activeOutsideBufferRequestedScrollTopPx = null;
			lastOutsideBufferRecoveryDispatchMs = null;
			outsideBufferRecoveryFramesRemaining = 0;
			return;
		}
		if (
			isCanonicalBottomScrollIntent({
				requestedScrollTopPx,
				totalHeightPx,
				viewportHeightPx: lastViewportHeightPx,
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			})
		) {
			locallyPinnedToBottom = true;
			if (!pinLiveScrollTopToRenderedBottom()) {
				return;
			}
			pendingOutsideBufferScrollTopPx = null;
			activeOutsideBufferRequestedScrollTopPx = null;
			lastOutsideBufferRecoveryDispatchMs = null;
			outsideBufferRecoveryFramesRemaining = 0;
			scheduleBottomPinRecovery();
			return;
		}
		queuePhysicalScrollCommand(
			"resolvedOutsideBufferTarget",
			requestedScrollTopPx,
			"immediate"
		);
		pendingOutsideBufferScrollTopPx = null;
		activeOutsideBufferRequestedScrollTopPx = null;
		lastOutsideBufferRecoveryDispatchMs = null;
		outsideBufferRecoveryFramesRemaining = 0;
	});
});

// Apply a Rust-decided scroll position once per push that carries one (initial
// open, reveal, follow-tail). Keyed on emissionSeq so it fires exactly once per
// repositioning push and never fights native scrolling on plain refills.
$effect(() => {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null) {
		return;
	}
	const target = projection.scrollTopTarget;
	if (target === null || projection.emissionSeq === lastAppliedScrollEmissionSeq) {
		return;
	}
	const hasAppliedAnyScrollTarget = lastAppliedScrollEmissionSeq >= 0;
	lastAppliedScrollEmissionSeq = projection.emissionSeq;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		if (pendingOutsideBufferScrollTopPx !== null) {
			return;
		}
		if (
			shouldIgnoreStaleFollowingTailTarget({
				modeKind: projection.mode.kind,
				liveNearBottom: isLiveViewportNearBottom(),
				locallyDetachedFromTail,
				hasAppliedAnyScrollTarget,
			})
		) {
			return;
		}
		if (Math.abs(scrollContainerRef.scrollTop - target) <= 1) {
			return;
		}
		queuePhysicalScrollCommand("rustScrollTarget", target);
	});
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
	if (scrollContainerRef === null || projection === null || sessionId === null) {
		return;
	}
	if (projection.emissionSeq === lastAppliedCorrectionEmissionSeq) {
		return;
	}
	lastAppliedCorrectionEmissionSeq = projection.emissionSeq;
	const targetSessionId = sessionId;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		const correction = sessionStore.consumeViewportScrollCorrectionPx(targetSessionId);
		if (correction === 0) {
			return;
		}
	if (locallyPinnedToTop && bufferProjection?.bufferStartIndex === 0) {
		return;
	}
	if (locallyPinnedToBottom && bufferProjection?.bufferEndIndex === bufferProjection?.layoutRowCount) {
		pinLiveScrollTopToRenderedBottom();
		return;
	}
		const current = scrollContainerRef.scrollTop;
		const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
		const next = Math.min(maxTop, Math.max(0, current + correction));
		if (Math.abs(next - current) <= 0.5) {
			return;
		}
		queuePhysicalScrollCommand("anchorCorrection", next);
	});
});

// Following-tail pin as a LOCAL invariant: when canonical layout grows during
// streaming, re-pin to the bottom after the new rows have rendered. Re-asserted
// only when totalHeightPx changes while in followingTail mode.
$effect(() => {
	const projection = bufferProjection;
	if (scrollContainerRef === null || projection === null) {
		return;
	}
	if (projection.mode.kind !== "followingTail") {
		lastFollowTailTotalHeightPx = -1;
		return;
	}
	if (locallyDetachedFromTail) {
		return;
	}
	if (totalHeightPx === lastFollowTailTotalHeightPx) {
		return;
	}
	lastFollowTailTotalHeightPx = totalHeightPx;
	void tick().then(() => {
		if (scrollContainerRef === null) {
			return;
		}
		const renderedTarget = renderedBottomScrollTargetPx();
		const maxTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
		const target = Math.min(maxTop, renderedTarget ?? maxTop);
		if (
			!shouldPinFollowingTailToRenderedBottom({
				currentScrollTopPx: scrollContainerRef.scrollTop,
				renderedBottomTargetPx: target,
				nearCanonicalBottom: isLiveViewportNearBottom(),
				thresholdPx: NEAR_EDGE_THRESHOLD_PX,
			})
		) {
			return;
		}
		if (Math.abs(scrollContainerRef.scrollTop - target) <= 1) {
			return;
		}
		queuePhysicalScrollCommand("followTailRenderedBottom", target);
	});
});

$effect(() => {
	if (pendingUserRevealRequestKey === null || pendingUserRevealRequestKey === consumedPendingUserRevealRequestKey) {
		return;
	}
	consumedPendingUserRevealRequestKey = pendingUserRevealRequestKey;
	dispatchRevealIntent(latestVisibleUserRowId());
});

export function scrollToBottom(_options?: { force?: boolean }) {
	locallyDetachedFromTail = false;
	locallyPinnedToTop = false;
	locallyPinnedToBottom = true;
	bottomJumpPinRequested = true;
	pinLiveScrollTopToRenderedBottom();
	scheduleBottomPinRecovery();
	dispatchRevealIntent(null);
}

export function prepareForNextUserReveal(_options?: { force?: boolean }) {
	dispatchRevealIntent(latestVisibleUserRowId());
}

export function scrollToTop() {
	dispatchScrollIntent(0, { forceFresh: true });
}
</script>

<div bind:this={viewportRef} use:observeViewport class="h-full min-h-0">
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
		bind:this={scrollContainerRef}
		data-testid="rust-transcript-viewport"
		data-buffer-start-index={bufferProjection?.bufferStartIndex}
		data-buffer-end-index={bufferProjection?.bufferEndIndex}
		data-buffer-layout-row-count={bufferProjection?.layoutRowCount}
		data-buffer-top-px={bufferProjection?.offsetsPx[0]}
		data-buffer-end-px={bufferProjection?.bufferEndOffsetPx}
		data-buffer-emission-seq={bufferProjection?.emissionSeq}
		data-buffer-mode={bufferProjection?.mode.kind}
		data-session-present={sessionId !== null}
		data-viewport-attachment-status={sessionStore.getViewportAttachmentStatus(sessionId)}
		class="h-full min-h-0 overflow-y-auto"
		style="overflow-anchor: none;"
		onscroll={handleScroll}
		onwheel={handleWheel}
	>
		<div style={`height: ${totalHeightPx}px; position: relative; width: 100%;`}>
			<div
				style={`position: absolute; left: 0; top: 0; width: 100%; transform: translateY(${windowTopPx}px); display: flex; flex-direction: column;`}
			>
				{#each renderedRows as rendered (rendered.row.rowId)}
					<div use:confirmRowHeight={rendered.row} data-entry-key={rendered.row.rowId}>
						<MessageWrapper
							entryIndex={rendered.index}
							entryKey={rendered.row.rowId}
							messageId={rendered.entry.type === "user" ? rendered.entry.id : undefined}
							observeRevealResize={false}
							{isFullscreen}
						>
							<AgentPanelConversationEntry
								entry={rendered.entry}
								iconBasePath="/svgs/icons"
								{editToolTheme}
								{projectPath}
								{streamingAnimationMode}
								renderAssistantBlock={renderAssistantBlock}
								{onQuestionSelect}
								{onPlanBuild}
								{onPlanCancel}
								{onPlanViewFull}
								{onToolFileSelect}
								{isPlanActionAvailable}
							/>
							{#if rendered.entry.type === "tool_call" && rendered.entry.toolCallId !== undefined && sessionId !== null}
								{@const attachedPermission = permissionStore.getForToolCall(sessionId, rendered.entry.toolCallId)}
								{#if attachedPermission !== undefined}
									<div class="tool-call-permission-row">
										<div class="tool-call-permission-attachment">
											<PermissionBar
												{sessionId}
												permission={attachedPermission}
												projectPath={projectPath ?? null}
												attachment="tool-call"
											/>
										</div>
									</div>
								{/if}
							{/if}
						</MessageWrapper>
					</div>
				{/each}
				{#if isWaitingForResponse}
					<div class="px-4 py-2" data-qa="waiting-indicator">
						<WaitingIndicator />
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.tool-call-permission-row {
		display: flex;
		position: relative;
		z-index: 1;
		margin-top: -1px;
		max-width: 100%;
		width: 100%;
	}

	.tool-call-permission-attachment {
		flex: 0 0 auto;
		max-width: 100%;
		width: fit-content;
	}
</style>
