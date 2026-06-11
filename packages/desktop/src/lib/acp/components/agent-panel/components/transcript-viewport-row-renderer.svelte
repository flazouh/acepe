<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";
import type {
	AgentPanelPlanActionEvent,
	AgentPanelPlanViewEvent,
	AgentPanelQuestionSelectEvent,
	AgentPanelSceneEntryModel,
	AgentToolFileSelectEvent,
	AssistantRenderBlockContext,
} from "@acepe/ui/agent-panel";
import type { Snippet } from "svelte";
import type { TranscriptViewportRow } from "../../../../services/acp-types.js";
import type { PermissionRequest } from "../../../types/permission-request.js";
import MessageWrapper from "../../messages/message-wrapper.svelte";
import PermissionBar from "../../tool-calls/permission-bar.svelte";

type RenderedViewportRow = {
	readonly row: TranscriptViewportRow;
	readonly index: number;
	readonly offsetPx: number;
	readonly entry: AgentPanelSceneEntryModel;
};

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
	renderedRows: readonly RenderedViewportRow[];
	sessionId?: string | null;
	projectPath: string | undefined;
	isFullscreen?: boolean;
	streamingAnimationMode: string;
	editToolTheme: string;
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
</script>

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
