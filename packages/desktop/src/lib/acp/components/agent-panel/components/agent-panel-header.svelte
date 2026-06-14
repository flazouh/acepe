<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconDotsVertical } from "@tabler/icons-svelte";
import { CloseAction, EmbeddedIconButton, FullscreenAction } from "@acepe/ui/panel-header";
import { DownloadSimple } from "phosphor-svelte";
import CopyButton from "../../messages/copy-button.svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import AttachmentChip from "../../shared/attachment-chip.svelte";

import { formatRichSessionTitle } from "$lib/acp/store/session-title-policy.js";

import { getPreparingThreadLabel } from "../logic/agent-panel-header-labels.js";
import type { AgentPanelHeaderProps } from "../types/agent-panel-header-props.js";

const isDev = import.meta.env.DEV;

let {
	pendingProjectSelection,
	isConnecting: _isConnecting,
	isRetryingConnection = false,
	sessionId,
	sessionTitle,
	sessionAgentId,
	agentIconSrc,
	agentName,
	isFullscreen,
	sessionStatus,
	projectPath: _projectPath,
	projectName,
	projectColor,
	projectIconSrc,
	sequenceId,
	linkedPr: _linkedPr = null,
	prLinkMode: _prLinkMode = "automatic",
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	onRetryConnection,
	onCopyStreamingLogPath,
	onExportRawStreaming,
	displayTitle = null,
	onExportMarkdown,
	onExportJson,
	onScrollToTop,
	firstMessageAttachments = [],
	debugPanelState,
}: AgentPanelHeaderProps = $props();

const hasExportSubmenu = $derived(onExportMarkdown != null || onExportJson != null);
const hasAttachments = $derived((firstMessageAttachments?.length ?? 0) > 0);
const preparingThreadLabel = $derived(getPreparingThreadLabel(agentName));
const titleRichText = $derived.by(() => {
	const rawTitle = sessionTitle ?? displayTitle;
	return formatRichSessionTitle(rawTitle, projectName).richText;
});
</script>

	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={!isFullscreen}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		titleRichText={titleRichText}
		agentIconSrc={agentIconSrc ? agentIconSrc : undefined}
		{isFullscreen}
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
			<div class="flex shrink-0 items-center gap-0.5 px-0.5">
			<AgentPanelStatusIcon
				status={sessionStatus}
				isRetrying={isRetryingConnection}
				agentId={sessionAgentId}
				warmingLabel={sessionStatus === "running" ? "Thread is running" : preparingThreadLabel}
				retryingLabel={"Retrying thread"}
				connectedLabel={sessionStatus === "idle"
					? "Thread is detached"
					: sessionStatus === "done"
						? "Thread is complete"
						: "Thread is connected"}
				errorLabel={"Thread error - click to retry"}
				onRetry={onRetryConnection}
			/>
			<Selector
				align="end"
				triggerSize="icon"
				showChevron={false}
				tooltipLabel="More actions"
				variant="ghost"
			>
				{#snippet renderButton()}
					<IconDotsVertical class="h-3 w-3" />
				{/snippet}

				<DropdownMenu.Item class="cursor-pointer">
					<CopyButton
						text={sessionId ?? ""}
						variant="menu"
						label={"Copy session ID"}
						hideIcon
						size={16}
					/>
				</DropdownMenu.Item>
				{#if hasExportSubmenu}
					<DropdownMenu.Separator />
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="cursor-pointer">
							{"Export"}
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="min-w-[160px]">
							{#if onExportMarkdown}
								<DropdownMenu.Item onSelect={() => onExportMarkdown?.()} class="cursor-pointer">
									{"Export as Markdown"}
								</DropdownMenu.Item>
							{/if}
							{#if onExportJson}
								<DropdownMenu.Item onSelect={() => onExportJson?.()} class="cursor-pointer">
									{"Export as JSON"}
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}
				{#if isDev}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => onCopyStreamingLogPath?.()} class="cursor-pointer">
						Copy Streaming Log Path
					</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => onExportRawStreaming?.()} class="cursor-pointer">
						{"Open Streaming Log"}
					</DropdownMenu.Item>
				{/if}
			</Selector>
			{#if isDev && debugPanelState}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<EmbeddedIconButton
							ariaLabel="Copy debug state"
							title="Copy debug state"
							onclick={async () => {
								const text = JSON.stringify(debugPanelState!, null, 2);
								await navigator.clipboard.writeText(text);
							}}
						>
							{#snippet children()}
								<DownloadSimple class="h-3 w-3" weight="fill" />
							{/snippet}
						</EmbeddedIconButton>
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" class="max-w-none">
						<div class="max-h-96 overflow-auto">
							<pre class="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(
									debugPanelState,
									null,
									2
								)}</pre>
						</div>
						<div class="mt-2 text-xs text-muted-foreground border-t pt-1">Click to copy JSON</div>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
			<FullscreenAction
				{isFullscreen}
				onToggle={onToggleFullscreen}
				titleEnter={"Fullscreen"}
				titleExit={"Exit Fullscreen"}
			/>
			<CloseAction {onClose} title={"Close"} />
			</div>
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
