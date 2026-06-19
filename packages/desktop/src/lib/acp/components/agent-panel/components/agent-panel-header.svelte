<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconDotsVertical } from "@tabler/icons-svelte";
import { CloseAction, EmbeddedIconButton } from "@acepe/ui/panel-header";
import { ArrowsIn, ArrowsOut, Browser, DownloadSimple, Terminal } from "phosphor-svelte";
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
	browserActive = false,
	browserTitle = "Toggle browser",
	browserAriaLabel,
	onToggleBrowser,
	terminalActive = false,
	terminalDisabled = false,
	terminalTitle = "Toggle terminal",
	terminalAriaLabel,
	onToggleTerminal,
}: AgentPanelHeaderProps = $props();

const hasPanelToolsMenu = $derived(
	onToggleFullscreen != null || onToggleBrowser != null || onToggleTerminal != null
);
const fullscreenMenuLabel = $derived(isFullscreen ? "Exit fullscreen" : "Fullscreen");
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
		onToggleFullscreen={undefined}
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
				{#if hasPanelToolsMenu}
					<DropdownMenu.Separator />
					{#if onToggleFullscreen}
						<DropdownMenu.Item onSelect={() => onToggleFullscreen?.()} class="cursor-pointer">
							<span class="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center">
								{#if isFullscreen}
									<ArrowsIn class="h-3.5 w-3.5" weight="fill" />
								{:else}
									<ArrowsOut class="h-3.5 w-3.5" weight="fill" />
								{/if}
							</span>
							{fullscreenMenuLabel}
						</DropdownMenu.Item>
					{/if}
					{#if onToggleBrowser}
						<DropdownMenu.CheckboxItem
							checked={browserActive}
							onCheckedChange={() => onToggleBrowser?.()}
							class="cursor-pointer"
						>
							<span class="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center">
								<Browser class="h-3.5 w-3.5" weight={browserActive ? "fill" : "regular"} />
							</span>
							{browserAriaLabel ?? browserTitle}
						</DropdownMenu.CheckboxItem>
					{/if}
					{#if onToggleTerminal}
						<DropdownMenu.CheckboxItem
							checked={terminalActive}
							disabled={terminalDisabled}
							onCheckedChange={() => {
								if (!terminalDisabled) {
									onToggleTerminal?.();
								}
							}}
							class="cursor-pointer"
						>
							<span class="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center">
								<Terminal class="h-3.5 w-3.5" weight="fill" />
							</span>
							{terminalAriaLabel ?? terminalTitle}
						</DropdownMenu.CheckboxItem>
					{/if}
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
