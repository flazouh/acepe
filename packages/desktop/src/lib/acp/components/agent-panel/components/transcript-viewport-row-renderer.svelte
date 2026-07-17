<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import type {
	AgentPanelConversationEntry as AgentPanelDisplayEntry,
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelReviewActionEvent,
	AgentTaskDetailPresentation,
	AgentTaskDetailRow,
	AgentUserFileSelectEvent,
	AgentToolFileSelectEvent,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import type { ComponentProps, Snippet } from "svelte";
import type { PermissionRequest } from "../../../types/permission.js";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";
import TranscriptViewportRowRenderer from "./transcript-viewport-row-renderer.svelte";

type ConversationEntryProps = ComponentProps<typeof AgentPanelConversationEntry>;

let {
	rowId,
	rowIndex,
	entry,
	sessionId = null,
	projectPath,
	showWorkingSpark = false,
	isFullscreen = false,
	streamingAnimationMode,
	editToolTheme,
	renderAssistantBlock,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	onUserFileSelect,
	onReview,
	isPlanActionAvailable,
	getAttachedPermission,
	taskDetailBindingFor,
}: {
	rowId: string;
	rowIndex: number;
	entry: AgentPanelDisplayEntry;
	sessionId?: string | null;
	projectPath: string | undefined;
	showWorkingSpark?: boolean;
	isFullscreen?: boolean;
	streamingAnimationMode: ConversationEntryProps["streamingAnimationMode"];
	editToolTheme: ConversationEntryProps["editToolTheme"];
	renderAssistantBlock: Snippet<[AssistantRenderBlockContext]>;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	onUserFileSelect?: (event: AgentUserFileSelectEvent) => void;
	onReview?: (event: AgentPanelReviewActionEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	getAttachedPermission: (sessionId: string, toolCallId: string) => PermissionRequest | undefined;
	taskDetailBindingFor: (
		rowId: string,
		entry: AgentPanelDisplayEntry
	) => {
		readonly presentation: AgentTaskDetailPresentation;
		readonly onOpenChange: (open: boolean) => void;
		readonly onLoadMore: () => void;
	} | null;
} = $props();

const taskDetailControllerBinding = $derived(taskDetailBindingFor(rowId, entry));
</script>

{#snippet renderTaskDetailRow(row: AgentTaskDetailRow, scopedRowIndex: number)}
	<TranscriptViewportRowRenderer
		rowId={row.rowId}
		rowIndex={scopedRowIndex}
		entry={row.entry}
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
		{onUserFileSelect}
		{onReview}
		{isPlanActionAvailable}
		{getAttachedPermission}
		{taskDetailBindingFor}
	/>
{/snippet}

<div
	class="transcript-viewport-row"
	data-entry-key={rowId}
	data-entry-type={entry.type}
	data-tool-kind={entry.type === "tool_call" ? entry.kind : undefined}
	data-tool-status={entry.type === "tool_call" ? entry.status : undefined}
	data-tool-title={entry.type === "tool_call" ? entry.title : undefined}
	data-tool-presentation-state={entry.type === "tool_call" ? entry.presentationState : undefined}
	data-missing-entry={entry.type === "missing" ? "" : undefined}
>
	<MessageWrapper
		entryIndex={rowIndex}
		entryKey={rowId}
		messageId={entry.type === "user" ? entry.id : undefined}
		observeRevealResize={false}
		{isFullscreen}
	>
		<AgentPanelConversationEntry
			{entry}
			iconBasePath="/svgs/icons"
			{editToolTheme}
			{projectPath}
			{streamingAnimationMode}
			{showWorkingSpark}
			{renderAssistantBlock}
			{onQuestionSelect}
			{onPlanBuild}
			{onPlanCancel}
			{onPlanViewFull}
			{onToolFileSelect}
			{onUserFileSelect}
			{onReview}
			{isPlanActionAvailable}
			taskDetail={taskDetailControllerBinding === null
				? null
				: {
						presentation: taskDetailControllerBinding.presentation,
						renderRow: renderTaskDetailRow,
						onOpenChange: taskDetailControllerBinding.onOpenChange,
						onLoadMore: taskDetailControllerBinding.onLoadMore,
					}}
		/>
		{#if entry.type === "tool_call" && entry.toolCallId !== undefined && sessionId !== null}
			{@const attachedPermission = getAttachedPermission(sessionId, entry.toolCallId)}
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

<style>
	.tool-call-permission-row {
		display: flex;
		position: relative;
		z-index: 1;
		margin-top: -1px;
		min-width: 0;
		max-width: 100%;
		width: 100%;
	}

	.tool-call-permission-attachment {
		flex: 1 1 auto;
		min-width: 0;
		max-width: 100%;
		width: 100%;
	}

	.transcript-viewport-row {
		min-width: 0;
		width: 100%;
		max-width: 100%;
	}
</style>
