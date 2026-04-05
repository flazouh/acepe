<script lang="ts">
import { ActivityEntry } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";
import IconChevronRight from "@tabler/icons-svelte/icons/chevron-right";
import IconDotsVertical from "@tabler/icons-svelte/icons/dots-vertical";
import Archive from "phosphor-svelte/lib/Archive";
import Tree from "phosphor-svelte/lib/Tree";
import PrStateIcon from "$lib/acp/components/pr-state-icon.svelte";
import { toast } from "svelte-sonner";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
import { getSessionListHighlightContext } from "$lib/acp/components/session-list/session-list-highlight-context.js";
import {
	AGENT_ICON_BASE_CLASS,
	getAgentIcon,
	UNKNOWN_TIME_TEXT,
} from "$lib/acp/constants/thread-list-constants.js";
import { formatTimeAgo } from "$lib/acp/logic/thread-list-date-utils.js";
import { getPanelStore } from "$lib/acp/store/index.js";
import { normalizeTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
import { createLogger } from "$lib/acp/utils/logger.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";
import { tauriClient } from "$lib/utils/tauri-client/index.js";
import { openFileInEditor } from "$lib/utils/tauri-client/opener.js";
import type { SessionDisplayItem as BaseSessionDisplayItem } from "$lib/acp/types/thread-display-item.js";

const logger = createLogger({ id: "session-item", name: "Session Item" });

const isDev = import.meta.env.DEV;

type SessionDisplayItem = BaseSessionDisplayItem & {
	worktreeDeleted?: boolean;
};

	interface Props {
		thread: SessionDisplayItem;
		selected?: boolean;
		isOpen?: boolean;
		onSelect?: (session: SessionDisplayItem) => void;
		depth?: number;
		hasChildren?: boolean;
		isExpanded?: boolean;
		onToggleExpand?: () => void;
		onArchive?: (session: SessionDisplayItem) => void | Promise<void>;
	onExportMarkdown?: (sessionId: string) => void | Promise<void>;
	onExportJson?: (sessionId: string) => void | Promise<void>;
	onOpenPr?: () => void;
	}

let {
	thread: session,
	selected = false,
	isOpen = false,
	onSelect,
	depth = 0,
	hasChildren = false,
	isExpanded = false,
	onToggleExpand,
	onArchive,
	onExportMarkdown,
	onExportJson,
		onOpenPr,
	}: Props = $props();

const themeState = useTheme();
const panelStore = getPanelStore();
const worktreeDeleted = $derived(session.worktreeDeleted ?? false);

function getThemedAgentIcon(agentId?: string): string {
	return getAgentIcon(agentId ?? "claude-code", themeState.effectiveTheme);
}

function getAgentIconClass(): string {
	return AGENT_ICON_BASE_CLASS;
}

function formatTimeAgoSafe(date: Date): string {
	const result = formatTimeAgo(date);
	return result.isOk() ? result.value : UNKNOWN_TIME_TEXT;
}

function capitalizeTitle(text: string): string {
	return text
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function getSessionDisplayName(item: SessionDisplayItem): string {
	const rawTitle = item.title || "";
	const cleanedTitle = normalizeTitleForDisplay(rawTitle);

	logger.debug("getSessionDisplayName", {
		raw: rawTitle.substring(0, 100),
		cleaned: cleanedTitle.substring(0, 100),
		isEmpty: cleanedTitle === "",
	});

	if (cleanedTitle !== "") {
		return capitalizeTitle(cleanedTitle);
	}

	if (item.projectName && item.projectName !== "Unknown") {
		return capitalizeTitle(`Conversation in ${item.projectName}`);
	}

	return "Untitled conversation";
}

function handleSelect() {
	onSelect?.(session);
}

function handleChevronClick(event: MouseEvent) {
	event.stopPropagation();
	onToggleExpand?.();
}

async function handleOpenRawFile() {
	await tauriClient.shell
		.getSessionFilePath(session.id, session.projectPath)
		.andThen((path) => openFileInEditor(path))
		.match(
			() => toast.success(m.thread_export_raw_success()),
			(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
		);
}

async function handleOpenInAcepe() {
	await tauriClient.shell.getSessionFilePath(session.id, session.projectPath).match(
		(fullPath) => {
			const parts = fullPath.split(/[/\\]/);
			const fileName = parts.pop() ?? fullPath;
			const dirPath = parts.join("/") || "/";
			panelStore.openFilePanel(fileName, dirPath);
		},
		(err) => toast.error(m.session_menu_open_raw_error({ error: err.message }))
	);
}

async function handleArchive() {
	await onArchive?.(session);
}

async function handleExportMarkdown() {
	await onExportMarkdown?.(session.id);
}

async function handleExportJson() {
	await onExportJson?.(session.id);
}

async function handleOpenStreamingLog() {
	await tauriClient.shell
		.openStreamingLog(session.id)
		.match(
			() => undefined,
			(err) => toast.error(m.thread_export_raw_error({ error: err.message }))
		);
}

function handleOpenPr(event: MouseEvent) {
	event.stopPropagation();
	onOpenPr?.();
}

const basePadding = 1;
const paddingLeft = $derived(`${basePadding + depth * 16}px`);

const isStreaming = $derived(session.activity?.isStreaming ?? false);

const queueTimeAgo = $derived(formatTimeAgoSafe(session.updatedAt ?? session.createdAt));
let isRowHovered = $state(false);
let isActionsMenuOpen = $state(false);
let rowElement: HTMLDivElement | null = null;
const actionsVisible = $derived(isRowHovered || isActionsMenuOpen);
const _actionsVisibilityClass = $derived(
	actionsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
);

$effect(() => {
	if (!actionsVisible || rowElement === null) {
		return;
	}

	const currentRow = rowElement;
	let rafId = 0;

	const tick = () => {
		// Defensive sync for flaky/missed pointerleave events.
		if (!isActionsMenuOpen && !currentRow.matches(":hover")) {
			isRowHovered = false;
			return;
		}
		rafId = window.requestAnimationFrame(tick);
	};

	rafId = window.requestAnimationFrame(tick);
	return () => {
		window.cancelAnimationFrame(rafId);
	};
});

const highlightCtx = getSessionListHighlightContext();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
		<div
			{...props}
			bind:this={rowElement}
			class="group relative z-10 flex items-stretch gap-1 py-0"
			style="padding-left: {paddingLeft}; padding-right: {paddingLeft}"
			data-session-id={session.id}
			onpointerenter={(e) => {
				isRowHovered = true;
				highlightCtx?.updateHighlight(e.currentTarget as HTMLElement);
			}}
			onpointerleave={() => {
				isRowHovered = false;
				highlightCtx?.clearHighlight();
			}}
		>
			{#if hasChildren}
				<button
					type="button"
					class="shrink-0 self-start mt-1 p-0.5 hover:bg-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onclick={handleChevronClick}
					aria-label={isExpanded ? m.aria_collapse() : m.aria_expand()}
				>
					{#if isExpanded}
						<IconChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
					{:else}
						<IconChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
					{/if}
				</button>
			{/if}

			<div class="flex-1 min-w-0">
				{#snippet agentBadge()}
					{#if isStreaming}
						<Spinner class="{getAgentIconClass()} m-0.5" />
					{:else}
						<img
							src={getThemedAgentIcon(session.agentId)}
							alt={m.alt_agent_icon()}
							class="{getAgentIconClass()} shrink-0 m-0.5"
							width="12"
							height="12"
						/>
					{/if}
					{#if session.worktreePath}
						<Tree
							size={12}
							weight="fill"
							class="shrink-0 m-0.5 {worktreeDeleted ? 'text-destructive' : 'text-success'}"
							color="currentColor"
							aria-label={worktreeDeleted ? "Worktree deleted" : "Worktree session"}
						/>
					{/if}
					{#if session.prNumber != null}
						<button
							type="button"
							class="inline-flex items-center gap-0.5 rounded-sm pl-0.5 pr-1 py-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							aria-label={`Open PR #${session.prNumber}`}
							title={`Open PR #${session.prNumber}`}
							onclick={handleOpenPr}
						>
							<PrStateIcon
								state={session.prState ?? "OPEN"}
								size={11}
							/>
							<span class="text-[10px] font-mono leading-none text-muted-foreground">
								#{session.prNumber}
							</span>
						</button>
					{/if}
				{/snippet}

				{#snippet rowActions()}
					<div class="flex items-center shrink-0">
						{#if onArchive}
							<button
								type="button"
								class="shrink-0 h-5 w-5 flex items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:[&_svg]:text-foreground"
								onclick={(e) => {
									e.stopPropagation();
									void handleArchive();
								}}
								aria-label="Archive session"
								title="Archive"
							>
								<Archive
									class="h-3.5 w-3.5 text-muted-foreground transition-colors"
									weight="fill"
									color="currentColor"
									aria-hidden="true"
								/>
							</button>
						{/if}
						<DropdownMenu.Root bind:open={isActionsMenuOpen}>
							<DropdownMenu.Trigger
								class="shrink-0 h-5 w-4 flex items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground hover:text-foreground"
								onclick={(e) => e.stopPropagation()}
							>
								<IconDotsVertical class="h-3.5 w-3.5" aria-hidden="true" />
								<span class="sr-only">Session actions</span>
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="end"
								class="min-w-[180px]"
								onclick={(e) => e.stopPropagation()}
							>
								<DropdownMenu.Item class="cursor-pointer">
									<CopyButton
										text={session.id}
										variant="menu"
										label={m.session_menu_copy_id()}
										hideIcon
										size={16}
									/>
								</DropdownMenu.Item>
								<DropdownMenu.Item class="cursor-pointer">
									<CopyButton
										getText={() => getSessionDisplayName(session)}
										variant="menu"
										label={m.session_menu_copy_title()}
										hideIcon
										size={16}
									/>
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={handleOpenRawFile} class="cursor-pointer">
									{m.session_menu_open_raw_file()}
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={handleOpenInAcepe} class="cursor-pointer">
									{m.session_menu_open_in_acepe()}
								</DropdownMenu.Item>
								{#if onExportMarkdown || onExportJson}
									<DropdownMenu.Separator />
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger class="cursor-pointer">
											{m.session_menu_export()}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="min-w-[160px]">
											{#if onExportMarkdown}
												<DropdownMenu.Item onSelect={handleExportMarkdown} class="cursor-pointer">
													{m.session_menu_export_markdown()}
												</DropdownMenu.Item>
											{/if}
											{#if onExportJson}
												<DropdownMenu.Item onSelect={handleExportJson} class="cursor-pointer">
													{m.session_menu_export_json()}
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
								{/if}
								{#if isDev}
									<DropdownMenu.Separator />
									<DropdownMenu.Item onSelect={handleOpenStreamingLog} class="cursor-pointer">
										{m.thread_export_raw_streaming()}
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				{/snippet}

				<ActivityEntry
					selected={selected || isOpen}
					onSelect={handleSelect}
					slidingHighlight={!!highlightCtx}
					compactPadding={!!highlightCtx}
					mode={null}
					title={session.sequenceId != null ? `#${session.sequenceId} ${getSessionDisplayName(session)}` : getSessionDisplayName(session)}
					timeAgo={queueTimeAgo}
					insertions={session.insertions ?? 0}
					deletions={session.deletions ?? 0}
					{agentBadge}
					{isStreaming}
					trailingAction={actionsVisible ? rowActions : undefined}
					taskDescription={null}
					taskSubagentSummaries={[]}
					showTaskSubagentList={false}
					fileToolDisplayText={null}
					toolContent={null}
					showToolShimmer={false}
					statusText={null}
					showStatusShimmer={false}
					todoProgress={null}
					currentQuestion={null}
					totalQuestions={0}
					hasMultipleQuestions={false}
					currentQuestionIndex={0}
					questionId=""
					questionProgress={[]}
					currentQuestionAnswered={false}
					currentAnswerDisplay=""
					currentQuestionOptions={[]}
					otherText=""
					otherPlaceholder=""
					showSubmitButton={false}
					canSubmit={false}
					submitLabel=""
					onOptionSelect={() => {
						return;
					}}
					onOtherInput={() => {
						return;
					}}
					onOtherKeydown={() => {
						return;
					}}
					onSubmitAll={() => {
						return;
					}}
					onPrevQuestion={() => {
						return;
					}}
					onNextQuestion={() => {
						return;
					}}
				/>
			</div>
		</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="right" sideOffset={8} class="max-w-60">
		{getSessionDisplayName(session)}
	</Tooltip.Content>
</Tooltip.Root>
