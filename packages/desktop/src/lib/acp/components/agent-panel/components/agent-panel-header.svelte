<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { CloseAction, FullscreenAction } from "@acepe/ui/panel-header";
import AttachmentChip from "../../shared/attachment-chip.svelte";

import type { AgentPanelHeaderProps } from "../types/agent-panel-header-props.js";

let {
	pendingProjectSelection,
	isConnecting,
	sessionId,
	sessionTitle,
	sessionAgentId,
	agentIconSrc,
	isFullscreen,
	sessionStatus,
	projectName,
	projectColor,
	projectIconSrc,
	sequenceId,
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	displayTitle = null,
	onScrollToTop,
	firstMessageAttachments = [],
}: AgentPanelHeaderProps = $props();

const hasAttachments = $derived((firstMessageAttachments?.length ?? 0) > 0);
</script>

	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={!isFullscreen}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		agentIconSrc={agentIconSrc ? agentIconSrc : undefined}
		{isFullscreen}
		{isConnecting}
		{pendingProjectSelection}
		projectName={hideProjectBadge ? undefined : projectName}
		projectColor={hideProjectBadge ? undefined : projectColor}
		projectIconSrc={hideProjectBadge ? undefined : projectIconSrc}
		sequenceId={hideProjectBadge ? undefined : sequenceId}
		{onClose}
		{onToggleFullscreen}
		{onScrollToTop}
	>
		{#snippet statusIndicator()}
			<!-- Status is shown via the controls snippet in the action cell -->
		{/snippet}

		{#snippet controls()}
			<AgentPanelStatusIcon
				status={sessionStatus}
				{isConnecting}
				agentId={sessionAgentId}
				warmingLabel={"Preparing thread..."}
				connectedLabel={"Thread is connected"}
				errorLabel={"Thread error - click to retry"}
			/>
			<FullscreenAction
				{isFullscreen}
				onToggle={onToggleFullscreen}
				titleEnter={"Fullscreen"}
				titleExit={"Exit Fullscreen"}
			/>
			<CloseAction {onClose} title={"Close"} />
		{/snippet}

		{#snippet expansion()}
			{#if hasAttachments}
				<div class="flex flex-wrap items-center gap-1">
					{#each firstMessageAttachments as attachment, i (`${attachment.type}-${attachment.path}-${i}`)}
						<AttachmentChip {attachment} />
					{/each}
				</div>
			{/if}
		{/snippet}
	</AgentPanelHeaderLayout>
