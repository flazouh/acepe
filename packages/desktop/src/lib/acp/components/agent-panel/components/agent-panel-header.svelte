<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconDotsVertical } from "@tabler/icons-svelte";
import { CloseAction } from "@acepe/ui/panel-header";
import {
	ArrowsIn,
	ArrowsOut,
	BracketsCurly,
	Browser,
	Bug,
	Copy,
	DownloadSimple,
	FileMd,
	Terminal,
	Tree,
} from "phosphor-svelte";
import { toast } from "svelte-sonner";
import AttachmentChip from "../../shared/attachment-chip.svelte";

import { formatRichSessionTitle } from "$lib/acp/store/session-title-policy.js";

import { copyTextToClipboard } from "../logic/clipboard-manager.js";
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
	isStreaming = false,
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
	browserActive = false,
	browserTitle = "Toggle browser",
	browserAriaLabel,
	onToggleBrowser,
	terminalActive = false,
	terminalDisabled = false,
	terminalTitle = "Toggle terminal",
	terminalAriaLabel,
	onToggleTerminal,
	activeWorktreePath = null,
	activeWorktreeLabel = null,
	onOpenWorktree,
}: AgentPanelHeaderProps = $props();

const hasWorktreeMenu = $derived(
	activeWorktreePath !== null &&
		activeWorktreePath !== undefined &&
		activeWorktreePath.length > 0 &&
		onOpenWorktree !== undefined
);
const openWorktreeMenuLabel = $derived(
	activeWorktreeLabel && activeWorktreeLabel.length > 0
		? `Open worktree · ${activeWorktreeLabel}`
		: "Open worktree"
);

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

const menuIconSlotClass =
	"inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground";

function handleCopySessionId(): void {
	const content = sessionId?.trim() ?? "";
	if (content.length === 0) {
		toast.error("No content to copy");
		return;
	}

	void copyTextToClipboard(content).match(
		() => {
			toast.success("Copied to clipboard");
		},
		() => {
			toast.error("Failed to copy");
		}
	);
}
</script>

	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={!isFullscreen}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		titleRichText={titleRichText}
		agentIconSrc={agentIconSrc ? agentIconSrc : undefined}
		{isFullscreen}
		{isStreaming}
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
					<IconDotsVertical class="size-2.5" />
				{/snippet}

				<DropdownMenu.Item onSelect={handleCopySessionId} class="cursor-pointer">
					<span class={menuIconSlotClass} aria-hidden="true">
						<Copy class="size-3.5" weight="regular" />
					</span>
					{"Copy session ID"}
				</DropdownMenu.Item>
				{#if hasWorktreeMenu}
					<DropdownMenu.Item onSelect={() => onOpenWorktree?.()} class="cursor-pointer">
						<span class={menuIconSlotClass}>
							<Tree class="size-3.5 text-success" weight="fill" />
						</span>
						{openWorktreeMenuLabel}
					</DropdownMenu.Item>
				{/if}
				{#if hasExportSubmenu}
					<DropdownMenu.Separator />
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="cursor-pointer">
							<span class={menuIconSlotClass} aria-hidden="true">
								<DownloadSimple class="size-3.5" weight="regular" />
							</span>
							{"Export"}
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="min-w-[160px]">
							{#if onExportMarkdown}
								<DropdownMenu.Item onSelect={() => onExportMarkdown?.()} class="cursor-pointer">
									<span class={menuIconSlotClass} aria-hidden="true">
										<FileMd class="size-3.5" weight="regular" />
									</span>
									{"Export as Markdown"}
								</DropdownMenu.Item>
							{/if}
							{#if onExportJson}
								<DropdownMenu.Item onSelect={() => onExportJson?.()} class="cursor-pointer">
									<span class={menuIconSlotClass} aria-hidden="true">
										<BracketsCurly class="size-3.5" weight="regular" />
									</span>
									{"Export as JSON"}
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}
				{#if isDev}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onSelect={() => onCopyStreamingLogPath?.()} class="cursor-pointer">
						<span class={menuIconSlotClass} aria-hidden="true">
							<Bug class="size-3.5" weight="fill" style="color: #FF5D5A" />
						</span>
						Copy Streaming Log Path
					</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => onExportRawStreaming?.()} class="cursor-pointer">
						<span class={menuIconSlotClass} aria-hidden="true">
							<Bug class="size-3.5" weight="fill" style="color: #FF5D5A" />
						</span>
						{"Open Streaming Log"}
					</DropdownMenu.Item>
				{/if}
				{#if hasPanelToolsMenu}
					<DropdownMenu.Separator />
					{#if onToggleFullscreen}
						<DropdownMenu.Item onSelect={() => onToggleFullscreen?.()} class="cursor-pointer">
							<span class={menuIconSlotClass}>
								{#if isFullscreen}
									<ArrowsIn class="size-3.5" weight="fill" />
								{:else}
									<ArrowsOut class="size-3.5" weight="fill" />
								{/if}
							</span>
							{fullscreenMenuLabel}
						</DropdownMenu.Item>
					{/if}
					{#if onToggleBrowser}
						<DropdownMenu.Item
							onSelect={() => onToggleBrowser?.()}
							class="cursor-pointer"
							aria-checked={browserActive}
						>
							<span class={menuIconSlotClass}>
								<Browser class="size-3.5" weight={browserActive ? "fill" : "regular"} />
							</span>
							{browserAriaLabel ?? browserTitle}
						</DropdownMenu.Item>
					{/if}
					{#if onToggleTerminal}
						<DropdownMenu.Item
							onSelect={() => {
								if (!terminalDisabled) {
									onToggleTerminal?.();
								}
							}}
							class="cursor-pointer"
							disabled={terminalDisabled}
							aria-checked={terminalActive}
						>
							<span class={menuIconSlotClass}>
								<Terminal class="size-3.5" weight={terminalActive ? "fill" : "regular"} />
							</span>
							{terminalAriaLabel ?? terminalTitle}
						</DropdownMenu.Item>
					{/if}
				{/if}
			</Selector>
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
