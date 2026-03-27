<!--
  AgentPanelFooter - Footer bar for the agent panel.

  Mirrors EmbeddedPanelHeader pattern: h-7 bar with border-t instead of border-b.
  Contains worktree picker (left) and embedded terminal toggle (right).
-->
<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import Browser from "phosphor-svelte/lib/Browser";
import Gear from "phosphor-svelte/lib/Gear";
import { Terminal } from "phosphor-svelte";
import * as m from "$lib/paraglide/messages.js";
import { WorktreeToggleControl } from "../../worktree-toggle/index.js";
import type {
	OnWorktreeCreatedCallback,
	OnWorktreeRenamedCallback,
} from "../../worktree-toggle/types.js";

interface Props {
	panelId: string;
	projectPath: string | null;
	activeWorktreePath: string | null;
	effectiveCwd: string | null;
	hasEdits: boolean;
	hasMessages: boolean;
	globalWorktreeDefault?: boolean;
	worktreeDeleted?: boolean;
	onWorktreeCreated: OnWorktreeCreatedCallback;
	onWorktreeRenamed?: OnWorktreeRenamedCallback;
	onPendingChange?: (pending: boolean) => void;
	onToggleTerminal: () => void;
	isTerminalDrawerOpen: boolean;
	onToggleBrowser: () => void;
	isBrowserSidebarOpen: boolean;
	onSettings?: () => void;
}

let {
	panelId,
	projectPath,
	activeWorktreePath,
	effectiveCwd,
	hasEdits,
	hasMessages,
	globalWorktreeDefault = false,
	worktreeDeleted = false,
	onWorktreeCreated,
	onWorktreeRenamed,
	onPendingChange,
	onToggleTerminal,
	isTerminalDrawerOpen,
	onToggleBrowser,
	isBrowserSidebarOpen,
	onSettings,
}: Props = $props();

const hasEffectiveCwd = $derived(effectiveCwd !== null);
const hasProjectPath = $derived(projectPath !== null);
const worktreeProjectPath = $derived(projectPath || "");
</script>

<div class="shrink-0 flex items-center h-7 border-t border-border/50">
	{#if hasProjectPath}
		<div class="min-w-0 flex-1">
			<WorktreeToggleControl
				{panelId}
				projectPath={worktreeProjectPath}
				projectName={null}
				{activeWorktreePath}
				{hasEdits}
				{hasMessages}
				{globalWorktreeDefault}
				{worktreeDeleted}
				{onWorktreeCreated}
				{onWorktreeRenamed}
				{onPendingChange}
				/>
		</div>
	{/if}

	{#if onSettings && hasProjectPath}
		<div class="shrink-0 flex items-center border-l border-border/50">
			<EmbeddedIconButton
				title={m.project_settings()}
				ariaLabel={m.project_settings()}
				onclick={onSettings}
			>
				<Gear class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</div>
	{/if}

	<div class="shrink-0 flex items-center border-l border-border/50">
		<EmbeddedIconButton
			active={isBrowserSidebarOpen}
			title="Toggle browser"
			ariaLabel="Toggle browser"
			onclick={onToggleBrowser}
		>
			<Browser class="h-3.5 w-3.5" weight={isBrowserSidebarOpen ? "fill" : "regular"} />
		</EmbeddedIconButton>
		<EmbeddedIconButton
			active={isTerminalDrawerOpen}
			disabled={!hasEffectiveCwd}
			title={hasEffectiveCwd
				? m.embedded_terminal_toggle_tooltip()
				: m.embedded_terminal_no_cwd_tooltip()}
			ariaLabel={m.embedded_terminal_toggle_tooltip()}
			onclick={onToggleTerminal}
		>
			<Terminal class="h-3.5 w-3.5" weight="fill" />
		</EmbeddedIconButton>
	</div>
</div>
