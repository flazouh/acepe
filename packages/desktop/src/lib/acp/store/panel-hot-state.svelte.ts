/**
 * PanelHotStateStore — the hot-state and suppression slice of the panel store,
 * extracted as a composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns per-panel transient UI state (drafts, review mode, sidebars, drawer expansion),
 * pending composer/user-entry restores, and auto-session suppression signals.
 * The parent `PanelStore` holds one instance and delegates its hot-state reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import { createLogger } from "../utils/logger.js";
import type { PanelHotState, SessionEntry } from "./types.js";
import { DEFAULT_PANEL_HOT_STATE } from "./types.js";

const logger = createLogger({ id: "panel-hot-state", name: "PanelHotStateStore" });

export interface PanelHotStateStoreDeps {
	onPersist: () => void;
	getEmbeddedTerminalTabCount: (panelId: string) => number;
	addEmbeddedTerminalTab: (panelId: string, cwd: string) => void;
}

export class PanelHotStateStore {
	private hotState = new SvelteMap<string, PanelHotState>();
	private suppressedAutoSessionSignals = new SvelteMap<string, string>();
	private latestLiveSessionSignals = new SvelteMap<string, string>();

	constructor(private readonly deps: PanelHotStateStoreDeps) {}

	getHotState(panelId: string): PanelHotState {
		return this.hotState.get(panelId) ?? DEFAULT_PANEL_HOT_STATE;
	}

	private updateHotState(panelId: string, updates: Partial<PanelHotState>): void {
		const current = this.hotState.get(panelId) ?? DEFAULT_PANEL_HOT_STATE;
		const updated = { ...current, ...updates };
		this.hotState.set(panelId, updated);
	}

	deleteHotState(panelId: string): void {
		this.hotState.delete(panelId);
	}

	recordAutoSessionSuppressionOnClose(
		sessionId: string | null,
		autoCreated: boolean | undefined
	): void {
		if (autoCreated !== true || sessionId === null) {
			return;
		}
		const signal = this.latestLiveSessionSignals.get(sessionId);
		if (signal !== undefined) {
			this.suppressedAutoSessionSignals.set(sessionId, signal);
		}
	}

	clearAutoSessionSuppression(sessionId: string): void {
		this.suppressedAutoSessionSignals.delete(sessionId);
	}

	syncAutoSessionSuppression(sessionId: string, signal: string): boolean {
		this.latestLiveSessionSignals.set(sessionId, signal);
		const suppressedSignal = this.suppressedAutoSessionSignals.get(sessionId);
		if (suppressedSignal === undefined) {
			return false;
		}
		if (suppressedSignal === signal) {
			return true;
		}
		this.suppressedAutoSessionSignals.delete(sessionId);
		return false;
	}

	setPlanSidebarExpanded(panelId: string, expanded: boolean): void {
		this.updateHotState(panelId, { planSidebarExpanded: expanded });
		this.deps.onPersist();
		logger.debug("Plan sidebar state updated", { panelId, expanded });
	}

	togglePlanSidebar(panelId: string): void {
		const current = this.getHotState(panelId).planSidebarExpanded;
		this.setPlanSidebarExpanded(panelId, !current);
	}

	isPlanSidebarExpanded(panelId: string): boolean {
		return this.getHotState(panelId).planSidebarExpanded;
	}

	setBrowserSidebarExpanded(panelId: string, expanded: boolean, url?: string): void {
		this.updateHotState(panelId, {
			browserSidebarExpanded: expanded,
			...(url != null ? { browserSidebarUrl: url } : {}),
		});
		this.deps.onPersist();
		logger.debug("Browser sidebar state updated", { panelId, expanded, url });
	}

	toggleBrowserSidebar(panelId: string): void {
		const current = this.getHotState(panelId).browserSidebarExpanded;
		this.setBrowserSidebarExpanded(panelId, !current);
	}

	isBrowserSidebarExpanded(panelId: string): boolean {
		return this.getHotState(panelId).browserSidebarExpanded;
	}

	setMessageDraft(panelId: string, draft: string): void {
		this.updateHotState(panelId, { messageDraft: draft });
		this.deps.onPersist();
	}

	getMessageDraft(panelId: string): string {
		return this.getHotState(panelId).messageDraft;
	}

	setProvisionalAutonomousEnabled(panelId: string, enabled: boolean): void {
		this.updateHotState(panelId, { provisionalAutonomousEnabled: enabled });
	}

	setPendingComposerRestore(
		panelId: string,
		restore: NonNullable<PanelHotState["pendingComposerRestore"]>
	): void {
		const current = this.getHotState(panelId);
		this.updateHotState(panelId, {
			pendingComposerRestore: restore,
			composerRestoreVersion: current.composerRestoreVersion + 1,
		});
	}

	consumePendingComposerRestore(panelId: string): PanelHotState["pendingComposerRestore"] {
		const restore = this.getHotState(panelId).pendingComposerRestore;
		if (restore === null) {
			return null;
		}
		this.updateHotState(panelId, { pendingComposerRestore: null });
		return restore;
	}

	isEmbeddedTerminalDrawerOpen(panelId: string): boolean {
		return this.getHotState(panelId).embeddedTerminalDrawerOpen;
	}

	setEmbeddedTerminalDrawerOpen(panelId: string, open: boolean): void {
		this.updateHotState(panelId, { embeddedTerminalDrawerOpen: open });
		this.deps.onPersist();
	}

	toggleEmbeddedTerminalDrawer(panelId: string, cwd: string): void {
		const isOpen = this.isEmbeddedTerminalDrawerOpen(panelId);
		if (!isOpen) {
			if (this.deps.getEmbeddedTerminalTabCount(panelId) === 0) {
				this.deps.addEmbeddedTerminalTab(panelId, cwd);
			}
		}
		this.setEmbeddedTerminalDrawerOpen(panelId, !isOpen);
	}

	setPendingUserEntry(panelId: string, entry: SessionEntry): void {
		this.updateHotState(panelId, { pendingUserEntry: entry });
	}

	clearPendingUserEntry(panelId: string): void {
		this.updateHotState(panelId, { pendingUserEntry: null });
	}

	setPendingWorktreeSetup(panelId: string, setup: PanelHotState["pendingWorktreeSetup"]): void {
		this.updateHotState(panelId, { pendingWorktreeSetup: setup });
	}

	clearPendingWorktreeSetup(panelId: string): void {
		this.updateHotState(panelId, { pendingWorktreeSetup: null });
	}

	setSignInRequirement(panelId: string, requirement: PanelHotState["signInRequirement"]): void {
		this.updateHotState(panelId, { signInRequirement: requirement });
	}

	clearSignInRequirement(panelId: string): void {
		this.updateHotState(panelId, { signInRequirement: null });
	}
}
