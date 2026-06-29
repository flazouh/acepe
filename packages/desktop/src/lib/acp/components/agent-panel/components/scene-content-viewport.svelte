<script lang="ts">
import { setIconConfig } from "@acepe/ui/icon-context";
import {
	MessageScroller,
	rowEstimatePx,
	type AgentPanelPlanActionEvent,
	type AgentPanelPlanViewEvent,
	type AgentPanelQuestionSelectEvent,
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
import { getPermissionStore } from "../../../store/permission-store.svelte.js";
import { getSessionStore } from "../../../store/session-store.svelte.js";
import { DEFAULT_STREAMING_ANIMATION_MODE } from "../../../types/streaming-animation-mode.js";
import { getWorkerPool } from "../../../utils/worker-pool-singleton.js";
import {
	pierreDiffsUnsafeCSS,
	registerCursorThemeForPierreDiffs,
} from "../../../utils/pierre-diffs-theme.js";
import ContentBlockRouter from "../../messages/content-block-router.svelte";
import TranscriptViewportRowRenderer from "./transcript-viewport-row-renderer.svelte";
import { buildRenderedTranscriptViewportRows } from "../logic/transcript-viewport-rendered-rows.js";
import type { RenderedTranscriptViewportRow } from "../logic/transcript-viewport-rendered-rows.js";
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
	rowsProjection = null,
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

let consumedPendingUserRevealRequestKey = $state<string | null>(null);
let bootstrappedSessionId: string | null = null;
let openedAtSessionId = $state<string | null>(null);
let scrollerController = $state<StickToBottomController | null>(null);

const bufferRows = $derived(rowsProjection?.rows ?? []);
const renderedRows = $derived.by(() => {
	return buildRenderedTranscriptViewportRows({
		bufferRows,
		bufferStartIndex: 0,
		sceneEntries: sceneEntries ?? EMPTY_SCENE_ENTRIES,
		showLocalPlanningIndicator,
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
	return null;
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
	if (sessionId === null || sessionId === bootstrappedSessionId) {
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
		jumpToLatestLabel="Jump to latest"
		onReady={setScrollerController}
		onEdgeStateChange={handleEdgeStateChange}
	/>
</div>
