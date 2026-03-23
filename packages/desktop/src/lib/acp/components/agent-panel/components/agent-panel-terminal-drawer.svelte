<!--
  AgentPanelTerminalDrawer - Embedded terminal drawer with tabs.

  Renders as a bottom drawer inside the agent panel. Contains a tab strip
  and the active tab's TerminalRenderer. Resizable via drag on the top edge.
  Wrapped in <svelte:boundary> for resilience against xterm.js crashes.
-->
<script lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import Plus from "phosphor-svelte/lib/Plus";
import X from "phosphor-svelte/lib/X";
import { onMount } from "svelte";
import type { EmbeddedTerminalTab } from "$lib/acp/store/embedded-terminal-store.svelte.js";
import { EmbeddedTerminalStore } from "$lib/acp/store/embedded-terminal-store.svelte.js";
import * as m from "$lib/paraglide/messages.js";

import { TerminalRenderer } from "../../terminal-panel/index.js";

interface Props {
	panelId: string;
	effectiveCwd: string;
	embeddedTerminals: EmbeddedTerminalStore;
	onClose: () => void;
}

let { panelId, effectiveCwd, embeddedTerminals, onClose }: Props = $props();

// ---- State ----

const DEFAULT_DRAWER_HEIGHT = 300;
const MIN_DRAWER_HEIGHT = 120;
const MAX_DRAWER_HEIGHT = 600;

let drawerHeight = $state(DEFAULT_DRAWER_HEIGHT);
let isResizing = $state(false);

const clampedHeight = $derived(
	Math.min(MAX_DRAWER_HEIGHT, Math.max(MIN_DRAWER_HEIGHT, drawerHeight))
);

const tabs = $derived(embeddedTerminals.getTabs(panelId));
const selectedTabId = $derived(embeddedTerminals.getSelectedTabId(panelId));
const selectedTab = $derived(embeddedTerminals.getSelectedTab(panelId));

// ---- Shell detection ----

let detectedShell: string | null = $state(null);
let shellError: string | null = $state(null);

onMount(() => {
	ResultAsync.fromPromise(invoke<string>("get_default_shell"), (e) =>
		e instanceof Error ? e.message : String(e)
	).match(
		(s) => {
			detectedShell = s;
		},
		(e) => {
			shellError = e;
		}
	);
});

// ---- Handlers ----

function handleAddTab(): void {
	embeddedTerminals.addTab(panelId, effectiveCwd);
}

function handleCloseTab(tabId: string): void {
	embeddedTerminals.closeTab(panelId, tabId);
	if (embeddedTerminals.getTabs(panelId).length === 0) {
		onClose();
	}
}

function handleSelectTab(tabId: string): void {
	embeddedTerminals.setSelectedTab(panelId, tabId);
}

function handlePtyCreated(tab: EmbeddedTerminalTab, ptyId: number): void {
	if (detectedShell) {
		embeddedTerminals.updatePty(panelId, tab.id, ptyId, detectedShell);
	}
}

// ---- Resize ----

let resizeStartY = 0;
let resizeStartHeight = 0;

function handleResizePointerDown(event: PointerEvent): void {
	const target = event.currentTarget;
	if (!(target instanceof HTMLElement)) return;

	isResizing = true;
	resizeStartY = event.clientY;
	resizeStartHeight = clampedHeight;
	target.setPointerCapture(event.pointerId);
}

function handleResizePointerMove(event: PointerEvent): void {
	if (!isResizing) return;
	const delta = resizeStartY - event.clientY;
	drawerHeight = Math.min(
		MAX_DRAWER_HEIGHT,
		Math.max(MIN_DRAWER_HEIGHT, resizeStartHeight + delta)
	);
}

function handleResizePointerUp(): void {
	isResizing = false;
}
</script>

<div
	class="flex flex-col bg-background"
	style="height: {clampedHeight}px; contain: layout;"
>
	<!-- Resize handle -->
	<div
		class="h-px hover:h-[3px] cursor-row-resize shrink-0 bg-border hover:bg-primary/50 transition-all
			{isResizing ? 'h-[3px] bg-primary/50' : ''}"
		role="separator"
		aria-orientation="horizontal"
		onpointerdown={handleResizePointerDown}
		onpointermove={handleResizePointerMove}
		onpointerup={handleResizePointerUp}
		onpointercancel={handleResizePointerUp}
	></div>

	<!-- Tab strip -->
	<div
		class="flex items-stretch h-7 shrink-0 border-b border-border/50"
		role="tablist"
		aria-label={m.terminal_panel_title()}
	>
		{#each tabs as tab, i (tab.id)}
			<div
				class="group inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs transition-colors cursor-pointer
					{tab.id === selectedTabId
					? 'bg-accent/25 text-foreground'
					: 'text-muted-foreground hover:bg-accent/15 hover:text-foreground'}"
				role="tab"
				tabindex="0"
				aria-selected={tab.id === selectedTabId}
				onclick={() => handleSelectTab(tab.id)}
				onkeydown={(e) => e.key === 'Enter' && handleSelectTab(tab.id)}
			>
				<span>{m.terminal_panel_title()} {i + 1}</span>
				<button
					type="button"
					class="inline-flex h-4 w-4 items-center justify-center rounded
						opacity-50 hover:opacity-100 hover:bg-muted-foreground/10 cursor-pointer"
					title={m.embedded_terminal_close_tab_tooltip()}
					onclick={(e) => {
						e.stopPropagation();
						handleCloseTab(tab.id);
					}}
				>
					<X size={12} weight="bold" />
				</button>
			</div>
		{/each}

		<!-- New tab button -->
		<button
			type="button"
			class="h-7 w-7 inline-flex items-center justify-center border-l border-border/50
				text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors cursor-pointer"
			title={m.terminal_new_tab()}
			onclick={handleAddTab}
		>
			<Plus size={12} weight="bold" />
		</button>
	</div>

	<!-- Terminal content with error boundary -->
	<div class="flex-1 min-h-0 overflow-hidden relative">
		<svelte:boundary>
			{#if detectedShell}
				{#each tabs as tab (tab.id)}
					<div
						class="absolute inset-0"
						class:hidden={tab.id !== selectedTabId}
					>
						<TerminalRenderer
							projectPath={tab.cwd}
							shell={detectedShell}
							onPtyCreated={(ptyId) => handlePtyCreated(tab, ptyId)}
							onPtyError={() => {}}
						/>
					</div>
				{/each}
			{:else if shellError}
				<div class="flex items-center justify-center h-full text-sm text-destructive p-4">
					{m.terminal_shell_error({ error: shellError })}
				</div>
			{:else}
				<div class="flex items-center justify-center h-full text-sm text-muted-foreground">
					{m.terminal_loading_shell()}
				</div>
			{/if}

			{#snippet failed(error)}
				<div class="flex items-center justify-center h-full text-sm text-destructive p-4">
					{m.embedded_terminal_error_fallback()}
				</div>
			{/snippet}
		</svelte:boundary>
	</div>
</div>
