<script lang="ts">
import type { TerminalPanelGroup, TerminalTab } from "$lib/acp/store/types.js";

import TerminalPanelComponent from "./terminal-panel.svelte";

interface TerminalTabsPanelStore {
	readonly fullscreenPanelId: string | null;
	readonly focusedPanelId: string | null;
	readonly viewMode: "single" | "project" | "multi";
	getSelectedTerminalTabId: (groupId: string) => string | null;
	setSelectedTerminalTab: (groupId: string, tabId: string) => void;
	openTerminalTab: (groupId: string) => TerminalTab | null;
	closeTerminalTab: (tabId: string) => void;
	moveTerminalTabToNewPanel: (tabId: string) => TerminalPanelGroup | null;
	canMoveTerminalTabToNewPanel: (tabId: string) => boolean;
	enterTerminalFullscreen: (groupId: string) => void;
	exitFullscreen: () => void;
	closeTerminalPanel: (groupId: string) => void;
	resizeTerminalPanel: (groupId: string, delta: number) => void;
	updateTerminalPtyId: (tabId: string, ptyId: number, shell: string) => void;
}

interface Props {
	group: TerminalPanelGroup;
	tabs: readonly TerminalTab[];
	projectPath: string;
	projectName: string;
	projectColor: string;
	projectIconSrc?: string | null;
	panelStore: TerminalTabsPanelStore;
}

let {
	group,
	tabs,
	projectPath,
	projectName,
	projectColor,
	projectIconSrc = null,
	panelStore,
}: Props = $props();

const selectedId = $derived.by(() => {
	const preferred = panelStore.getSelectedTerminalTabId(group.id);
	const valid = tabs.some((tab) => tab.id === preferred);
	if (valid) {
		return preferred;
	}
	const firstTab = tabs[0];
	return firstTab ? firstTab.id : null;
});

const selectedTerminal = $derived(
	selectedId
		? tabs.find((tab) => tab.id === selectedId)
			? tabs.find((tab) => tab.id === selectedId)
			: null
		: null
);

const isAuxFullscreen = $derived(
	panelStore.fullscreenPanelId === group.id ||
		(panelStore.viewMode === "single" && panelStore.focusedPanelId === group.id)
);

function handleSelectTab(tabId: string) {
	panelStore.setSelectedTerminalTab(group.id, tabId);
}

function handleNewTerminal() {
	panelStore.openTerminalTab(group.id);
}

function handleCloseTab(tabId: string) {
	panelStore.closeTerminalTab(tabId);
}

function handleMoveTabToNewPanel(tabId: string) {
	panelStore.moveTerminalTabToNewPanel(tabId);
}
</script>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
	{#if selectedTerminal}
		<div
			class="flex-1 min-h-0 min-w-0"
		>
			<TerminalPanelComponent
				panelId={group.id}
				projectPath={selectedTerminal.projectPath}
				{projectName}
				{projectColor}
				{projectIconSrc}
				width={group.width}
				shell={selectedTerminal.shell}
				hideProjectBadge={true}
				isFullscreenEmbedded={isAuxFullscreen}
				{isAuxFullscreen}
				tabs={tabs}
				selectedTabId={selectedId}
				onSelectTab={handleSelectTab}
				onNewTab={handleNewTerminal}
				onCloseTab={handleCloseTab}
				onMoveTabToNewPanel={handleMoveTabToNewPanel}
				canMoveTabToNewPanel={(tabId: string) => panelStore.canMoveTerminalTabToNewPanel(tabId)}
				onEnterFullscreen={() => panelStore.enterTerminalFullscreen(group.id)}
				onExitFullscreen={() => panelStore.exitFullscreen()}
				onClose={() => panelStore.closeTerminalPanel(group.id)}
				onResize={(panelId: string, delta: number) =>
					panelStore.resizeTerminalPanel(panelId, delta)}
				onPtyCreated={(ptyId: number, shell: string) =>
					panelStore.updateTerminalPtyId(selectedTerminal.id, ptyId, shell)}
			/>
		</div>
	{/if}
</div>
