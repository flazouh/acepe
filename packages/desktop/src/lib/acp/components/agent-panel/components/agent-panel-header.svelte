<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import { HugeiconsIcon, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import type { HugeiconsIconName } from "@acepe/ui/icons";
import { CloseAction } from "@acepe/ui/panel-header";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ResultAsync } from "neverthrow";
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

type HeaderMenuContentWidth = "min-w-[180px]" | "min-w-[210px]" | "min-w-[220px]";

type HeaderMenuIcon = { readonly name: HugeiconsIconName };

type HeaderMenuAction = {
	readonly id: string;
	readonly label: string;
	readonly icon: HeaderMenuIcon;
	readonly onSelect: () => void;
	readonly disabled?: boolean;
	readonly checked?: boolean;
};

type HeaderMenuActionGroup = {
	readonly id: string;
	readonly actions: readonly HeaderMenuAction[];
};

type HeaderMenuSection = {
	readonly id: string;
	readonly label: string;
	readonly icon: HeaderMenuIcon;
	readonly contentWidthClass: HeaderMenuContentWidth;
	readonly groups: readonly HeaderMenuActionGroup[];
};

const menuSections = $derived.by(() => {
	const sections: HeaderMenuSection[] = [];
	const copySection = createCopyMenuSection();
	const openSection = createOpenMenuSection();
	const displaySection = createDisplayMenuSection();
	const diagnosticsSection = createDiagnosticsMenuSection();

	if (copySection !== null) {
		sections.push(copySection);
	}
	if (openSection !== null) {
		sections.push(openSection);
	}
	if (displaySection !== null) {
		sections.push(displaySection);
	}
	if (diagnosticsSection !== null) {
		sections.push(diagnosticsSection);
	}

	return sections;
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
	icon: HeaderMenuIcon,
	onSelect: () => void
): HeaderMenuAction {
	return {
		id,
		label,
		icon,
		onSelect,
	};
}

function hugeiconsMenuIcon(name: HugeiconsIconName): HeaderMenuIcon {
	return { name };
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
	icon: HeaderMenuIcon,
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
			createMenuAction(
				"copy-title",
				"Title",
				hugeiconsMenuIcon("file-text"),
				handleCopySessionTitle
			)
		);
	}

	if (sessionId != null) {
		identityActions.push(
			createMenuAction(
				"copy-session-id",
				"Session ID",
				hugeiconsMenuIcon("copy-id"),
				handleCopySessionId
			)
		);
	}

	if (hasCopyThreadContentFallback) {
		transcriptActions.push(
			createMenuAction("copy-thread-content", "Thread content", hugeiconsMenuIcon("copy"), () => {
				void onCopyContent?.();
			})
		);
	}

	if (onExportMarkdown != null) {
		transcriptActions.push(
			createMenuAction(
				"export-markdown",
				"Transcript as Markdown",
				hugeiconsMenuIcon("file-text"),
				() => {
					void onExportMarkdown?.();
				}
			)
		);
	}

	if (onExportJson != null) {
		transcriptActions.push(
			createMenuAction("export-json", "Transcript as JSON", hugeiconsMenuIcon("code"), () => {
				void onExportJson?.();
			})
		);
	}

	return createMenuSection("copy", "Copy", hugeiconsMenuIcon("copy"), "min-w-[220px]", [
		createMenuGroup("identity", identityActions),
		createMenuGroup("transcript", transcriptActions),
	]);
}

function createOpenMenuSection(): HeaderMenuSection | null {
	const actions: HeaderMenuAction[] = [];

	if (onOpenInAcepe != null) {
		actions.push(
			createMenuAction(
				"open-in-acepe",
				"View Transcript File",
				hugeiconsMenuIcon("app-window"),
				() => {
					void onOpenInAcepe?.();
				}
			)
		);
	}

	if (onOpenRawFile != null) {
		actions.push(
			createMenuAction(
				"open-raw-file",
				"Open Raw Transcript",
				hugeiconsMenuIcon("document"),
				() => {
					void onOpenRawFile?.();
				}
			)
		);
	}

	if (onOpenInFinder != null) {
		actions.push(
			createMenuAction(
				"reveal-transcript",
				"Reveal Transcript in Finder",
				hugeiconsMenuIcon("folder"),
				() => {
					void onOpenInFinder?.();
				}
			)
		);
	}

	if (hasWorktreeMenu) {
		actions.push(
			createMenuAction(
				"open-worktree",
				openWorktreeMenuLabel,
				hugeiconsMenuIcon("worktree"),
				() => {
					onOpenWorktree?.();
				}
			)
		);
	}

	if (hasPullRequestMenu) {
		actions.push(
			createMenuAction(
				"open-pull-request",
				pullRequestMenuLabel,
				hugeiconsMenuIcon("pull-request"),
				handleOpenPullRequest
			)
		);
	}

	return createMenuSection("open", "Open", hugeiconsMenuIcon("folder"), "min-w-[220px]", [
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
				hugeiconsMenuIcon(isFullscreen ? "collapse" : "expand"),
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
			icon: hugeiconsMenuIcon("browser"),
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
			icon: hugeiconsMenuIcon("terminal"),
			checked: terminalActive,
			disabled: terminalDisabled,
			onSelect: () => {
				if (!terminalDisabled) {
					onToggleTerminal?.();
				}
			},
		});
	}

	return createMenuSection("display", "Display", hugeiconsMenuIcon("settings"), "min-w-[180px]", [
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
			createMenuAction(
				"copy-streaming-log-path",
				"Copy Streaming Log Path",
				hugeiconsMenuIcon("copy"),
				() => {
					void onCopyStreamingLogPath?.();
				}
			)
		);
	}

	if (onExportRawStreaming != null) {
		actions.push(
			createMenuAction(
				"open-streaming-log",
				"Open Streaming Log",
				hugeiconsMenuIcon("terminal"),
				() => {
					void onExportRawStreaming?.();
				}
			)
		);
	}

	return createMenuSection(
		"diagnostics",
		"Diagnostics",
		hugeiconsMenuIcon("terminal"),
		"min-w-[210px]",
		[createMenuGroup("logs", actions)]
	);
}
</script>

{#snippet menuItemContent(icon: HeaderMenuIcon, label: string)}
	<HugeiconsIcon name={icon.name} />
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
						<HugeiconsIcon name="more" />
					{/snippet}

					{#each menuSections as section, sectionIndex (section.id)}
						{#if sectionIndex > 0}
							<DropdownMenu.Separator />
						{/if}
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger>
								{@render menuItemContent(section.icon, section.label)}
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class={section.contentWidthClass}>
								{#each section.groups as group, groupIndex (group.id)}
									{#if groupIndex > 0}
										<DropdownMenu.Separator />
									{/if}

									{#each group.actions as action (action.id)}
										<DropdownMenu.Item
											onSelect={action.onSelect}
											disabled={action.disabled}
											aria-checked={action.checked}
										>
											{@render menuItemContent(action.icon, action.label)}
										</DropdownMenu.Item>
									{/each}
								{/each}
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/each}
				</Selector>
				<CloseAction {onClose} title={"Close"} size="icon-sm" />
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
