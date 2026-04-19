<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	CloseAction,
	FullscreenAction,
	OverflowMenuTriggerAction,
} from "@acepe/ui/panel-header";
import { DownloadSimple } from "phosphor-svelte";
import CopyButton from "../../messages/copy-button.svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import AgentSelector from "../../agent-selector.svelte";
import AttachmentChip from "../../shared/attachment-chip.svelte";

import type { AgentPanelHeaderProps } from "../types/agent-panel-header-props.js";

const isDev = import.meta.env.DEV;

let {
	pendingProjectSelection,
	isConnecting,
	sessionId,
	sessionTitle,
	sessionAgentId,
	currentAgentId,
	availableAgents,
	agentIconSrc,
	agentName: _agentName,
	isFullscreen,
	sessionStatus,
	projectName,
	projectColor,
	projectIconSrc,
	sequenceId,
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	onCopyStreamingLogPath,
	onExportRawStreaming,
	displayTitle = null,
	onExportMarkdown,
	onExportJson,
	onAgentChange,
	onScrollToTop,
	firstMessageAttachments = [],
	// Debug props
	debugPanelState,
}: AgentPanelHeaderProps = $props();

const hasExportSubmenu = $derived(onExportMarkdown != null || onExportJson != null);
const hasAttachments = $derived((firstMessageAttachments?.length ?? 0) > 0);
</script>

	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={!isFullscreen}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		{agentIconSrc}
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

		{#snippet leadingControl()}
			<AgentSelector
				{availableAgents}
				{currentAgentId}
				onAgentChange={(agentId) => onAgentChange?.(agentId)}
				variant="ghost"
				buttonClass="size-5 rounded p-0 text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors data-[state=open]:bg-accent"
				contentClass="min-w-[220px]"
				showChevron={false}
			/>
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
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="h-7 w-7 flex items-center justify-center focus-visible:outline-none"
				>
					<OverflowMenuTriggerAction title="More actions" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-[180px]">
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
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if isDev && debugPanelState}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<button
							type="button"
							class="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
							onclick={async () => {
								const text = JSON.stringify(debugPanelState!, null, 2);
								await navigator.clipboard.writeText(text);
							}}
						>
							<DownloadSimple class="size-4" weight="fill" aria-label="Copy debug state" />
						</button>
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
