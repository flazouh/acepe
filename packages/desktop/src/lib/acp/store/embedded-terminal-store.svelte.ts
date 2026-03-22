import { SvelteMap } from "svelte/reactivity";

import type { PersistedEmbeddedTerminalState } from "./types.js";

/**
 * Runtime embedded terminal tab state.
 * `ptyId` and `shell` are runtime-only — stripped on serialize, reset on restore.
 */
export interface EmbeddedTerminalTab {
	readonly id: string;
	readonly cwd: string;
	readonly ptyId: number | null;
	readonly shell: string | null;
}

/**
 * Manages embedded terminal state for agent panel drawers.
 *
 * Composed by PanelStore — not a standalone store. All terminal tabs are
 * scoped to an owning agent panel. PTY lifecycle follows belt-and-suspenders:
 * cleanup is triggered from the store (not just component onDestroy).
 */
export class EmbeddedTerminalStore {
	/** Terminal tabs per agent panel */
	private tabsByPanel = new SvelteMap<string, EmbeddedTerminalTab[]>();

	/** Selected tab ID per agent panel */
	private selectedTabByPanel = new SvelteMap<string, string>();

	/** Callback to dirty-flag workspace for persistence */
	private readonly onPersist: () => void;

	constructor(onPersist: () => void) {
		this.onPersist = onPersist;
	}

	// ============================================
	// TAB QUERIES
	// ============================================

	/**
	 * Get all terminal tabs for a panel.
	 */
	getTabs(panelId: string): readonly EmbeddedTerminalTab[] {
		return this.tabsByPanel.get(panelId) || [];
	}

	/**
	 * Get the selected tab ID for a panel.
	 * Falls back to the first tab if the stored selection is stale.
	 */
	getSelectedTabId(panelId: string): string | null {
		const tabs = this.getTabs(panelId);
		if (tabs.length === 0) return null;

		const preferred = this.selectedTabByPanel.get(panelId);
		const valid = preferred !== undefined && tabs.some((t) => t.id === preferred);
		return valid ? preferred : tabs[0]?.id || null;
	}

	/**
	 * Get the currently selected tab for a panel, or null.
	 */
	getSelectedTab(panelId: string): EmbeddedTerminalTab | null {
		const selectedId = this.getSelectedTabId(panelId);
		if (selectedId === null) return null;
		const tabs = this.getTabs(panelId);
		return tabs.find((t) => t.id === selectedId) || null;
	}

	// ============================================
	// TAB MUTATIONS
	// ============================================

	/**
	 * Add a new terminal tab to a panel.
	 * Returns the new tab.
	 */
	addTab(panelId: string, cwd: string): EmbeddedTerminalTab {
		const tab: EmbeddedTerminalTab = {
			id: crypto.randomUUID(),
			cwd,
			ptyId: null,
			shell: null,
		};

		const existing = this.tabsByPanel.get(panelId) || [];
		this.tabsByPanel.set(panelId, [...existing, tab]);
		this.selectedTabByPanel.set(panelId, tab.id);
		this.onPersist();
		return tab;
	}

	/**
	 * Close a terminal tab. If it was selected, selects the next tab.
	 *
	 * Note: PTY kill is handled by the component's onDestroy when the tab
	 * unmounts. For panel close, use cleanup() which kills PTYs directly.
	 */
	closeTab(panelId: string, tabId: string): void {
		const tabs = this.tabsByPanel.get(panelId) || [];
		const filtered = tabs.filter((t) => t.id !== tabId);
		this.tabsByPanel.set(panelId, filtered);

		// Update selection if needed
		const currentSelected = this.selectedTabByPanel.get(panelId);
		if (currentSelected === tabId) {
			if (filtered.length > 0) {
				this.selectedTabByPanel.set(panelId, filtered[0]?.id);
			} else {
				this.selectedTabByPanel.delete(panelId);
			}
		}

		this.onPersist();
	}

	/**
	 * Select a tab by ID.
	 */
	setSelectedTab(panelId: string, tabId: string): void {
		this.selectedTabByPanel.set(panelId, tabId);
		this.onPersist();
	}

	/**
	 * Update a tab's runtime PTY state after spawn.
	 */
	updatePty(panelId: string, tabId: string, ptyId: number, shell: string): void {
		const tabs = this.tabsByPanel.get(panelId);
		if (!tabs) return;

		this.tabsByPanel.set(
			panelId,
			tabs.map((t) => (t.id === tabId ? { ...t, ptyId, shell } : t))
		);
		// No onPersist — ptyId/shell are runtime-only
	}

	// ============================================
	// CLEANUP
	// ============================================

	/**
	 * Clean up all embedded terminal state for a panel.
	 * Called by PanelStore.closePanel() — belt-and-suspenders.
	 *
	 * Note: We track ptyIds but cannot call pty.kill() from the store
	 * because IPty instances are held by the TerminalRenderer component.
	 * The component's onDestroy handles PTY kill. This method ensures
	 * state is cleaned up even if the component fails to unmount.
	 */
	cleanup(panelId: string): void {
		this.tabsByPanel.delete(panelId);
		this.selectedTabByPanel.delete(panelId);
		// onPersist not needed — the panel is being removed
	}

	// ============================================
	// PERSISTENCE
	// ============================================

	/**
	 * Serialize all embedded terminal state for workspace save.
	 */
	serialize(): PersistedEmbeddedTerminalState[] {
		const result: PersistedEmbeddedTerminalState[] = [];
		for (const [panelId, tabs] of this.tabsByPanel) {
			if (tabs.length > 0) {
				result.push({
					panelId,
					tabs: tabs.map((t) => ({ id: t.id, cwd: t.cwd })),
				});
			}
		}
		return result;
	}

	/**
	 * Restore embedded terminal state from workspace.
	 * Panel IDs must already be remapped by the caller.
	 */
	restore(
		states: ReadonlyArray<PersistedEmbeddedTerminalState>,
		panelIdMap: ReadonlyMap<string, string>,
		selectedTabByPanelId: ReadonlyMap<string, string>
	): void {
		for (const state of states) {
			const newPanelId = panelIdMap.get(state.panelId) || state.panelId;
			const tabs: EmbeddedTerminalTab[] = state.tabs.map((t) => ({
				...t,
				ptyId: null,
				shell: null,
			}));
			if (tabs.length > 0) {
				this.tabsByPanel.set(newPanelId, tabs);

				// Restore selected tab
				const oldSelectedId = selectedTabByPanelId.get(state.panelId);
				if (oldSelectedId && tabs.some((t) => t.id === oldSelectedId)) {
					this.selectedTabByPanel.set(newPanelId, oldSelectedId);
				} else if (tabs.length > 0) {
					this.selectedTabByPanel.set(newPanelId, tabs[0]?.id);
				}
			}
		}
	}
}
