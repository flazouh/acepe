<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentToolFileSelectEvent,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import type { ComponentProps, Snippet } from "svelte";
import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import type { PermissionRequest } from "../../../types/permission.js";
import type { RenderedTranscriptViewportRow } from "../logic/transcript-viewport-rendered-rows.js";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";

type ConversationEntryProps = ComponentProps<typeof AgentPanelConversationEntry>;

let {
	renderedRows,
	sessionId = null,
	projectPath,
	isFullscreen = false,
	streamingAnimationMode,
	editToolTheme,
	renderAssistantBlock,
	onQuestionSelect,
	onPlanBuild,
	onPlanCancel,
	onPlanViewFull,
	onToolFileSelect,
	isPlanActionAvailable,
	getAttachedPermission,
	confirmRowHeight,
}: {
	renderedRows: readonly RenderedTranscriptViewportRow[];
	sessionId?: string | null;
	projectPath: string | undefined;
	isFullscreen?: boolean;
	streamingAnimationMode: ConversationEntryProps["streamingAnimationMode"];
	editToolTheme: ConversationEntryProps["editToolTheme"];
	renderAssistantBlock: Snippet<[AssistantRenderBlockContext]>;
	onQuestionSelect?: (event: AgentPanelQuestionSelectEvent) => void;
	onPlanBuild?: (event: AgentPanelPlanActionEvent) => void;
	onPlanCancel?: (event: AgentPanelPlanActionEvent) => void;
	onPlanViewFull?: (event: AgentPanelPlanViewEvent) => void;
	onToolFileSelect?: (event: AgentToolFileSelectEvent) => void;
	isPlanActionAvailable?: (event: AgentPanelPlanActionEvent) => boolean;
	getAttachedPermission: (
		sessionId: string,
		toolCallId: string
	) => PermissionRequest | undefined;
	confirmRowHeight: (node: HTMLDivElement, row: TranscriptViewportRow) => {
		update: (nextRow: TranscriptViewportRow) => void;
		destroy: () => void;
	};
} = $props();

function ignoreLocalRowHeight(_node: HTMLDivElement, _row: TranscriptViewportRow) {
	return {
		update(_nextRow: TranscriptViewportRow) {},
		destroy() {},
	};
}
</script>

{#each renderedRows as rendered (rendered.row.rowId)}
	{@const rowHeightAction = rendered.localOnly ? ignoreLocalRowHeight : confirmRowHeight}
	<div use:rowHeightAction={rendered.row} data-entry-key={rendered.row.rowId}>
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
				{renderAssistantBlock}
				{onQuestionSelect}
				{onPlanBuild}
				{onPlanCancel}
				{onPlanViewFull}
				{onToolFileSelect}
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
{/each}

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
