<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { RoundedIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { RoundedIconName } from "@acepe/ui/icons";
import { CloseAction } from "@acepe/ui/panel-header";
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
	linkedPr = null,
	prLinkMode: _prLinkMode = "automatic",
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	onRetryConnection,
	onCopyContent,
	onOpenInFinder,
	onCopyStreamingLogPath,
	onExportRawStreaming,
	displayTitle = null,
	onOpenRawFile,
	onOpenInAcepe,
	onExportMarkdown,
	onExportJson,
	onScrollToTop,
	firstMessageAttachments = [],
	browserActive = false,
	browserTitle: _browserTitle = "Toggle browser",
	browserAriaLabel: _browserAriaLabel,
	onToggleBrowser,
	terminalActive = false,
	terminalDisabled = false,
	terminalTitle = "Toggle terminal",
	terminalAriaLabel: _terminalAriaLabel,
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

const fullscreenMenuLabel = $derived(isFullscreen ? "Exit fullscreen" : "Fullscreen");
const browserMenuLabel = $derived(browserActive ? "Hide browser" : "Show browser");
const terminalMenuLabel = $derived(
	terminalDisabled ? terminalTitle : terminalActive ? "Hide terminal" : "Show terminal"
);
const hasCopyTitle = $derived((displayTitle ?? sessionTitle ?? "").trim().length > 0);
const hasCopyThreadContentFallback = $derived(onCopyContent != null && onExportJson == null);
const pullRequestUrl = $derived(linkedPr?.url?.trim() ?? "");
const hasPullRequestMenu = $derived(pullRequestUrl.length > 0);
const pullRequestMenuLabel = $derived(
	linkedPr ? `Open Pull Request #${linkedPr.prNumber}` : "Open Pull Request"
);
const hasAttachments = $derived((firstMessageAttachments?.length ?? 0) > 0);
const preparingThreadLabel = $derived(getPreparingThreadLabel(agentName));
const titleRichText = $derived.by(() => {
	const rawTitle = sessionTitle ?? displayTitle;
	return formatRichSessionTitle(rawTitle, projectName).richText;
});

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

function handleCopySessionTitle(): void {
	const content = (displayTitle ?? sessionTitle ?? "").trim();
	if (content.length === 0) {
		toast.error("No title to copy");
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

function handleOpenPullRequest(): void {
	if (pullRequestUrl.length === 0) {
		toast.error("No pull request to open");
		return;
	}

	void ResultAsync.fromPromise(
		openUrl(pullRequestUrl),
		(error) => new Error(error instanceof Error ? error.message : String(error))
	).match(
		() => undefined,
		(error) => {
			toast.error(`Failed to open pull request: ${error.message}`);
		}
	);
}

function createMenuAction(
	id: string,
	label: string,
	icon: RoundedIconName,
	onSelect: () => void
): HeaderMenuAction {
	return {
		id,
		label,
		icon,
		onSelect,
	};
}

function createMenuGroup(id: string, actions: readonly HeaderMenuAction[]): HeaderMenuActionGroup {
	return {
		id,
		actions,
	};
}

function createMenuSection(
	id: string,
	label: string,
	icon: RoundedIconName,
	contentWidthClass: HeaderMenuContentWidth,
	groups: readonly HeaderMenuActionGroup[]
): HeaderMenuSection | null {
	const visibleGroups: HeaderMenuActionGroup[] = [];

	for (const group of groups) {
		if (group.actions.length > 0) {
			visibleGroups.push(group);
		}
	}

	if (visibleGroups.length === 0) {
		return null;
	}

	return {
		id,
		label,
		icon,
		contentWidthClass,
		groups: visibleGroups,
	};
}

function createCopyMenuSection(): HeaderMenuSection | null {
	const identityActions: HeaderMenuAction[] = [];
	const transcriptActions: HeaderMenuAction[] = [];

	if (hasCopyTitle) {
		identityActions.push(
			createMenuAction("copy-title", "Title", "file-text", handleCopySessionTitle)
		);
	}

	if (sessionId != null) {
		identityActions.push(
			createMenuAction("copy-session-id", "Session ID", "code", handleCopySessionId)
		);
	}

	if (hasCopyThreadContentFallback) {
		transcriptActions.push(
			createMenuAction("copy-thread-content", "Thread content", "copy", () => {
				void onCopyContent?.();
			})
		);
	}

	if (onExportMarkdown != null) {
		transcriptActions.push(
			createMenuAction("export-markdown", "Transcript as Markdown", "file-text", () => {
				void onExportMarkdown?.();
			})
		);
	}

	if (onExportJson != null) {
		transcriptActions.push(
			createMenuAction("export-json", "Transcript as JSON", "code", () => {
				void onExportJson?.();
			})
		);
	}

	return createMenuSection("copy", "Copy", "copy", "min-w-[220px]", [
		createMenuGroup("identity", identityActions),
		createMenuGroup("transcript", transcriptActions),
	]);
}

function createOpenMenuSection(): HeaderMenuSection | null {
	const actions: HeaderMenuAction[] = [];

	if (onOpenInAcepe != null) {
		actions.push(
			createMenuAction("open-in-acepe", "View Transcript File", "app-window", () => {
				void onOpenInAcepe?.();
			})
		);
	}

	if (onOpenRawFile != null) {
		actions.push(
			createMenuAction("open-raw-file", "Open Raw Transcript", "document", () => {
				void onOpenRawFile?.();
			})
		);
	}

	if (onOpenInFinder != null) {
		actions.push(
			createMenuAction("reveal-transcript", "Reveal Transcript in Finder", "folder", () => {
				void onOpenInFinder?.();
			})
		);
	}

	if (hasWorktreeMenu) {
		actions.push(
			createMenuAction("open-worktree", openWorktreeMenuLabel, "worktree", () => {
				onOpenWorktree?.();
			})
		);
	}

	if (hasPullRequestMenu) {
		actions.push(
			createMenuAction(
				"open-pull-request",
				pullRequestMenuLabel,
				"pull-request",
				handleOpenPullRequest
			)
		);
	}

	return createMenuSection("open", "Open", "folder", "min-w-[220px]", [
		createMenuGroup("destinations", actions),
	]);
}

function createDisplayMenuSection(): HeaderMenuSection | null {
	const actions: HeaderMenuAction[] = [];

	if (onToggleFullscreen != null) {
		actions.push(
			createMenuAction(
				"toggle-fullscreen",
				fullscreenMenuLabel,
				isFullscreen ? "collapse" : "expand",
				() => {
					onToggleFullscreen?.();
				}
			)
		);
	}

	if (onToggleBrowser != null) {
		actions.push({
			id: "toggle-browser",
			label: browserMenuLabel,
			icon: "browser",
			checked: browserActive,
			onSelect: () => {
				onToggleBrowser?.();
			},
		});
	}

	if (onToggleTerminal != null) {
		actions.push({
			id: "toggle-terminal",
			label: terminalMenuLabel,
			icon: "terminal",
			checked: terminalActive,
			disabled: terminalDisabled,
			onSelect: () => {
				if (!terminalDisabled) {
					onToggleTerminal?.();
				}
			},
		});
	}

	return createMenuSection("display", "Display", "settings", "min-w-[180px]", [
		createMenuGroup("panel-tools", actions),
	]);
}

function createDiagnosticsMenuSection(): HeaderMenuSection | null {
	if (!isDev) {
		return null;
	}

	const actions: HeaderMenuAction[] = [];

	if (onCopyStreamingLogPath != null) {
		actions.push(
			createMenuAction("copy-streaming-log-path", "Copy Streaming Log Path", "copy", () => {
				void onCopyStreamingLogPath?.();
			})
		);
	}

	if (onExportRawStreaming != null) {
		actions.push(
			createMenuAction("open-streaming-log", "Open Streaming Log", "terminal", () => {
				void onExportRawStreaming?.();
			})
		);
	}

	return createMenuSection("diagnostics", "Diagnostics", "terminal", "min-w-[210px]", [
		createMenuGroup("logs", actions),
	]);
}
</script>

{#snippet menuItemContent(icon: RoundedIconName, label: string)}
	<RoundedIcon name={icon} />
	<span class="min-w-0 flex-1 truncate">{label}</span>
{/snippet}

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
					triggerSize="iconSm"
					showChevron={false}
					tooltipLabel="More actions"
					variant="ghost"
				>
					{#snippet renderButton()}
						<RoundedIcon name="more" />
					{/snippet}

				<DropdownMenu.Item onSelect={handleCopySessionId} class="cursor-pointer">
					{"Copy session ID"}
				</DropdownMenu.Item>
				{#if hasWorktreeMenu}
					<DropdownMenu.Item onSelect={() => onOpenWorktree?.()} class="cursor-pointer">
						{openWorktreeMenuLabel}
					</DropdownMenu.Item>
				{/if}
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
							{fullscreenMenuLabel}
						</DropdownMenu.Item>
					{/if}
					{#if onToggleBrowser}
						<DropdownMenu.Item
							onSelect={() => onToggleBrowser?.()}
							class="cursor-pointer"
							aria-checked={browserActive}
						>
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
