<script lang="ts">
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { TerminalPanel } from "$lib/acp/store/terminal-panel-type.js";

import * as m from "$lib/paraglide/messages.js";

import TerminalPanelComponent from "./terminal-panel.svelte";

/** Minimal shape for resolved fullscreen aux (we only need to check kind and panel.id). */
type FullscreenAuxPanelResolved = { kind: string; panel: { id: string } } | null;

interface Props {
	terminals: readonly TerminalPanel[];
	projectPath: string;
	projectName: string;
	projectColor: string;
	panelStore: PanelStore;
	fullscreenAuxPanel: FullscreenAuxPanelResolved;
}

let { terminals, projectPath, projectName, projectColor, panelStore, fullscreenAuxPanel }: Props =
	$props();

const selectedId = $derived.by(() => {
	const preferred = panelStore.selectedTerminalPanelIdByProject[projectPath];
	const valid = terminals.some((t) => t.id === preferred);
	return valid ? preferred : (terminals[0]?.id ?? null);
});

const selectedTerminal = $derived(
	selectedId ? (terminals.find((t) => t.id === selectedId) ?? null) : null
);

const isAuxFullscreen = $derived(
	(panelStore.fullscreenPanelId !== null || panelStore.fullscreenAuxOnly) &&
		fullscreenAuxPanel?.kind === "terminal" &&
		selectedTerminal !== null &&
		fullscreenAuxPanel.panel.id === selectedTerminal.id
);

function handleSelectTab(panelId: string) {
	panelStore.setSelectedTerminalPanel(projectPath, panelId);
}

function handleNewTerminal() {
	panelStore.openTerminalPanel(projectPath);
}

function handleCloseTab(tabId: string) {
	panelStore.closeTerminalPanel(tabId);
}
</script>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
	{#each terminals as terminal (terminal.id)}
		<div
			class="flex-1 min-h-0 min-w-0"
			class:hidden={terminal.id !== selectedId}
		>
			<TerminalPanelComponent
				panelId={terminal.id}
				projectPath={terminal.projectPath}
				{projectName}
				{projectColor}
				width={terminal.width}
				shell={terminal.shell}
				hideProjectBadge={true}
				isFullscreenEmbedded={isAuxFullscreen}
				{isAuxFullscreen}
				tabs={terminals}
				selectedTabId={selectedId}
				onSelectTab={handleSelectTab}
				onNewTab={handleNewTerminal}
				onCloseTab={handleCloseTab}
				onEnterFullscreen={() => panelStore.enterTerminalFullscreen(terminal.id)}
				onExitFullscreen={() => panelStore.exitFullscreen()}
				onClose={() => panelStore.closeTerminalPanel(terminal.id)}
				onResize={(panelId: string, delta: number) =>
					panelStore.resizeTerminalPanel(panelId, delta)}
				onPtyCreated={(ptyId: number, shell: string) =>
					panelStore.updateTerminalPtyId(terminal.id, ptyId, shell)}
			/>
		</div>
	{/each}
</div>
