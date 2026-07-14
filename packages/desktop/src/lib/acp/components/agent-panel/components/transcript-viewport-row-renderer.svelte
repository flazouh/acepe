<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelReviewActionEvent,
	AgentUserFileSelectEvent,
	AgentToolFileSelectEvent,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import type { ComponentProps, Snippet } from "svelte";
import type { PermissionRequest } from "../../../types/permission.js";
import type { RenderedTranscriptViewportRow } from "../logic/transcript-viewport-rendered-rows.js";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";

type ConversationEntryProps = ComponentProps<typeof AgentPanelConversationEntry>;

let {
	rendered,
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
}: {
	rendered: RenderedTranscriptViewportRow;
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
} = $props();
</script>

<div
	class="transcript-viewport-row"
	data-entry-key={rendered.row.rowId}
	data-entry-type={rendered.entry.type}
	data-tool-kind={rendered.entry.type === "tool_call" ? rendered.entry.kind : undefined}
	data-tool-status={rendered.entry.type === "tool_call" ? rendered.entry.status : undefined}
	data-tool-title={rendered.entry.type === "tool_call" ? rendered.entry.title : undefined}
	data-tool-presentation-state={rendered.entry.type === "tool_call" ? rendered.entry.presentationState : undefined}
	data-missing-entry={rendered.entry.type === "missing" ? "" : undefined}
>
	<MessageWrapper
		entryIndex={rendered.index}
		entryKey={rendered.row.rowId}
		messageId={rendered.entry.type === "user" ? rendered.entry.id : undefined}
		observeRevealResize={false}
		{isFullscreen}
	>
		<AgentPanelConversationEntry
			entry={rendered.entry}
			iconBasePath="hugeicons"
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
		/>
		{#if rendered.entry.type === "tool_call" && rendered.entry.toolCallId !== undefined && sessionId !== null}
			{@const attachedPermission = getAttachedPermission(sessionId, rendered.entry.toolCallId)}
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
