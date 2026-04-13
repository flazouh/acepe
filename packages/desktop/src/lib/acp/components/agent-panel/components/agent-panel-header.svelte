<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	CloseAction,
	EmbeddedPanelHeader,
	FullscreenAction,
	HeaderActionCell,
	HeaderTitleCell,
	OverflowMenuTriggerAction,
} from "@acepe/ui/panel-header";
import { ArrowUUpLeft } from "phosphor-svelte";
import { DownloadSimple } from "phosphor-svelte";
import { Tree } from "phosphor-svelte";
import CopyButton from "../../messages/copy-button.svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

import type { AgentPanelHeaderProps } from "../types/agent-panel-header-props.js";

const isDev = import.meta.env.DEV;

let {
	pendingProjectSelection,
	isConnecting,
	sessionId,
	sessionTitle,
	sessionAgentId,
	agentIconSrc,
	agentName: _agentName,
	isFullscreen,
	sessionStatus,
	projectName,
	projectColor,
	sequenceId,
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	onCopyStreamingLogPath,
	onExportRawStreaming,
	displayTitle = null,
	onExportMarkdown,
	onExportJson,
	onScrollToTop,
	// Debug props
	debugPanelState,
	// Worktree close confirmation
	worktreeCloseConfirming = false,
	worktreeName = null,
	worktreeHasDirtyChanges = false,
	worktreeDirtyCheckPending = false,
	onWorktreeCloseOnly,
	onWorktreeRemoveAndClose,
	onWorktreeCloseCancel,
}: AgentPanelHeaderProps = $props();

const hasExportSubmenu = $derived(onExportMarkdown != null || onExportJson != null);
const panelHeaderClass = $derived("bg-card/50");
</script>

{#if worktreeCloseConfirming}
	<EmbeddedPanelHeader class={panelHeaderClass}>
		<HeaderTitleCell>
			{#snippet children()}
				<span class="text-[11px] font-medium truncate text-muted-foreground">
					{worktreeDirtyCheckPending
						? m.worktree_toggle_checking()
						: worktreeHasDirtyChanges
						? m.worktree_close_confirm_dirty_title({ name: worktreeName ?? "worktree" })
						: m.worktree_close_confirm_title({ name: worktreeName ?? "worktree" })}
				</span>
			{/snippet}
		</HeaderTitleCell>
		<HeaderActionCell>
			{#snippet children()}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1 h-7 px-2 cursor-pointer hover:text-destructive hover:bg-destructive/10 transition-colors border-l border-border/50"
						onclick={() => onWorktreeRemoveAndClose?.()}
						aria-label={m.worktree_close_confirm_remove_and_close()}
						disabled={worktreeDirtyCheckPending}
					>
						<Tree class="h-3.5 w-3.5 text-destructive shrink-0" weight="fill" />
						<span class="text-[10px] font-medium text-destructive">{m.worktree_close_confirm_remove_label()}</span>
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>{m.worktree_close_confirm_remove_and_close()}</Tooltip.Content>
			</Tooltip.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1 h-7 px-2 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-l border-border/50"
						onclick={() => onWorktreeCloseOnly?.()}
						aria-label={m.worktree_close_confirm_close_only()}
					>
						<Tree class="h-3.5 w-3.5 text-success shrink-0" weight="fill" />
						<span class="text-[10px] font-medium">{m.worktree_close_confirm_keep_label()}</span>
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>{m.worktree_close_confirm_close_only()}</Tooltip.Content>
			</Tooltip.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="inline-flex items-center justify-center h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-l border-border/50"
						onclick={() => onWorktreeCloseCancel?.()}
						aria-label={m.common_cancel()}
					>
						<ArrowUUpLeft class="h-3.5 w-3.5" weight="fill" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>{m.common_cancel()}</Tooltip.Content>
			</Tooltip.Root>
			{/snippet}
		</HeaderActionCell>
	</EmbeddedPanelHeader>
{:else}
	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={false}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		{agentIconSrc}
		{isFullscreen}
		{isConnecting}
		{pendingProjectSelection}
		projectName={hideProjectBadge ? undefined : projectName}
		projectColor={hideProjectBadge ? undefined : projectColor}
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
				warmingLabel={m.thread_status_preparing()}
				connectedLabel={m.thread_status_connected()}
				errorLabel={m.thread_status_error()}
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
							label={m.session_menu_copy_id()}
							hideIcon
							size={16}
						/>
					</DropdownMenu.Item>
					{#if hasExportSubmenu}
						<DropdownMenu.Separator />
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger class="cursor-pointer">
								{m.session_menu_export()}
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class="min-w-[160px]">
								{#if onExportMarkdown}
									<DropdownMenu.Item onSelect={() => onExportMarkdown?.()} class="cursor-pointer">
										{m.session_menu_export_markdown()}
									</DropdownMenu.Item>
								{/if}
								{#if onExportJson}
									<DropdownMenu.Item onSelect={() => onExportJson?.()} class="cursor-pointer">
										{m.session_menu_export_json()}
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
							{m.thread_export_raw_streaming()}
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
				titleEnter={m.panel_fullscreen()}
				titleExit={m.panel_exit_fullscreen()}
			/>
			<CloseAction {onClose} title={m.common_close()} />
		{/snippet}
	</AgentPanelHeaderLayout>
{/if}
