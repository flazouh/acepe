/**
 * PanelAgentState — the agent-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns top-level agent panel list/indexes, session open/materialize/spawn lifecycle,
 * session-id remap, and worktree-card fields on panel objects. Cross-slice focus and
 * fullscreen ordering flow through accessor-closure dependencies; the parent `PanelStore`
 * holds one instance and delegates its agent-domain reads/writes here.
 *
 * GOD: this slice holds panel-shaped UI state only. Session truth stays in canonical
 * projections — no `canonical ?? hotState` fallback and no local actionability derivation.
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { resolveAgentPanelHeaderSequenceId } from "../components/agent-panel/logic/agent-panel-header-sequence-id.js";
import type { PreparedWorktreeLaunch } from "../types/worktree-info.js";
import { createLogger } from "../utils/logger.js";
import {
	createAppendedItemArray,
	createPatchedItemArray,
	createPrependedItemArray,
} from "./panel-store-array-patches.js";
import { areAgentPanelListsEqual } from "./panel-store-equality.js";
import type { Panel, WorkspacePanel, WorkspacePanelKind } from "./types.js";
import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./types.js";

const logger = createLogger({ id: "panel-agent-state", name: "PanelAgentState" });

export type ReactiveValue<T> = {
	current: T;
};

class ReactiveValueBox<T> implements ReactiveValue<T> {
	current = $state<T>(undefined as T);

	constructor(current: T) {
		this.current = current;
	}
}

function createReactiveValue<T>(current: T): ReactiveValue<T> {
	return new ReactiveValueBox(current);
}

export interface SessionIdentitySlice {
	readonly agentId: string | null;
	readonly projectPath: string | null;
	readonly worktreePath: string | null;
}

export interface SessionMetadataSlice {
	readonly sourcePath: string | null;
	readonly title: string | null;
	readonly sequenceId: number | null;
}

export interface PanelAgentStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	replaceAgentPanelsInWorkspace: (nextAgentPanels: readonly Panel[]) => void;
	insertAgentPanelInWorkspace: (panel: Panel, placement: "prepend" | "append") => void;
	patchAgentPanelInWorkspace: (panel: Panel) => void;
	getSessionIdentity: (sessionId: string) => SessionIdentitySlice | undefined;
	getSessionMetadata: (sessionId: string) => SessionMetadataSlice | undefined;
	hasPendingCreationSession: (sessionId: string) => boolean;
	getPendingCreationSession: (sessionId: string) => { readonly sequenceId: number | null } | null;
	resolveCanonicalSessionId: (requestedId: string) => string | null;
	focusOpenedTopLevelPanel: (panelId: string) => void;
	onSpawnedPanelFocused: (panel: Panel) => void;
	onExistingSessionOpened: (panel: Panel) => void;
	onDuplicatePanelDisposed?: (panelId: string) => void;
	clearAutoSessionSuppression: (sessionId: string) => void;
	onPersist: () => void;
}

export class PanelAgentState {
	private topLevelAgentPanelList = $state<Panel[]>([]);
	private topLevelAgentPanelsById = new SvelteMap<string, Panel>();
	private topLevelAgentPanelBySessionId = new SvelteMap<string, Panel>();
	private topLevelAgentPanelsByProject = new SvelteMap<string, Panel[]>();
	private topLevelAgentPanelRefs = new Map<string, ReactiveValue<Panel | null>>();
	private openingSessionIds = new SvelteSet<string>();

	readonly panelBySessionId = $derived.by(() => this.topLevelAgentPanelBySessionId);
	readonly panelCount = $derived(this.topLevelAgentPanelList.length);

	constructor(private readonly deps: PanelAgentStateDeps) {}

	get panels(): Panel[] {
		return this.deps
			.getWorkspacePanels()
			.filter((panel): panel is Panel => panel.kind === "agent" && panel.ownerPanelId === null);
	}

	set panels(nextPanels: Panel[]) {
		this.syncTopLevelAgentPanelIndex(nextPanels);
		this.deps.replaceAgentPanelsInWorkspace(nextPanels);
		this.clearRemovedTopLevelAgentPanelRefs(nextPanels);
	}

	syncTopLevelAgentPanelIndex(nextPanels: readonly Panel[]): void {
		if (!areAgentPanelListsEqual(this.topLevelAgentPanelList, nextPanels)) {
			this.topLevelAgentPanelList = Array.from(nextPanels);
		}
		this.topLevelAgentPanelBySessionId.clear();
		const panelsByProject = new Map<string, Panel[]>();
		for (const panel of nextPanels) {
			if (panel.sessionId !== null) {
				const canonicalSessionId = this.resolveOpenSessionId(panel.sessionId);
				const incumbent = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
				if (incumbent === undefined) {
					this.topLevelAgentPanelBySessionId.set(canonicalSessionId, panel);
				}
			}
			if (panel.projectPath !== null) {
				const projectPanels = panelsByProject.get(panel.projectPath);
				if (projectPanels === undefined) {
					panelsByProject.set(panel.projectPath, [panel]);
				} else {
					projectPanels.push(panel);
				}
			}
			const current = this.topLevelAgentPanelsById.get(panel.id);
			const isSame =
				current !== undefined &&
				current.id === panel.id &&
				current.sessionId === panel.sessionId &&
				current.width === panel.width &&
				current.pendingProjectSelection === panel.pendingProjectSelection &&
				current.pendingWorktreeEnabled === panel.pendingWorktreeEnabled &&
				current.preparedWorktreeLaunch === panel.preparedWorktreeLaunch &&
				current.selectedAgentId === panel.selectedAgentId &&
				current.projectPath === panel.projectPath &&
				current.agentId === panel.agentId &&
				current.sourcePath === panel.sourcePath &&
				current.worktreePath === panel.worktreePath &&
				current.sessionTitle === panel.sessionTitle &&
				current.autoCreated === panel.autoCreated;
			if (!isSame) {
				this.topLevelAgentPanelsById.set(panel.id, panel);
				const ref = this.topLevelAgentPanelRefs.get(panel.id);
				if (ref) {
					ref.current = panel;
				}
			} else if (!this.topLevelAgentPanelRefs.has(panel.id)) {
				this.topLevelAgentPanelRefs.set(panel.id, createReactiveValue(panel));
			}
		}
		for (const [projectPath, panels] of panelsByProject) {
			const existingPanels = this.topLevelAgentPanelsByProject.get(projectPath);
			if (areAgentPanelListsEqual(existingPanels, panels)) {
				panelsByProject.set(projectPath, existingPanels ?? panels);
			}
		}
		this.topLevelAgentPanelsByProject = new SvelteMap(panelsByProject);
	}

	clearRemovedTopLevelAgentPanelRefs(nextPanels: readonly Panel[]): void {
		const nextIds = new Set(nextPanels.map((panel) => panel.id));
		for (const panelId of this.topLevelAgentPanelsById.keys()) {
			if (nextIds.has(panelId)) {
				continue;
			}
			this.topLevelAgentPanelsById.delete(panelId);
			this.topLevelAgentPanelRefs.delete(panelId);
		}
	}

	patchTopLevelAgentPanel(updatedPanel: Panel): void {
		const currentPanel = this.topLevelAgentPanelsById.get(updatedPanel.id);
		if (currentPanel === undefined) {
			return;
		}

		this.topLevelAgentPanelsById.set(updatedPanel.id, updatedPanel);
		const ref = this.topLevelAgentPanelRefs.get(updatedPanel.id);
		if (ref) {
			ref.current = updatedPanel;
		}
		if (currentPanel.sessionId !== null && currentPanel.sessionId !== updatedPanel.sessionId) {
			const previousCanonicalId = this.resolveOpenSessionId(currentPanel.sessionId);
			this.topLevelAgentPanelBySessionId.delete(previousCanonicalId);
		}
		if (updatedPanel.sessionId !== null) {
			const canonicalSessionId = this.resolveOpenSessionId(updatedPanel.sessionId);
			const incumbent = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
			if (incumbent !== undefined && incumbent.id !== updatedPanel.id) {
				return;
			}
			this.topLevelAgentPanelBySessionId.set(canonicalSessionId, updatedPanel);
		}
		this.topLevelAgentPanelList = createPatchedItemArray(this.topLevelAgentPanelList, updatedPanel);
		if (updatedPanel.projectPath !== null) {
			const projectPanels = this.topLevelAgentPanelsByProject.get(updatedPanel.projectPath);
			if (projectPanels !== undefined) {
				this.topLevelAgentPanelsByProject.set(
					updatedPanel.projectPath,
					createPatchedItemArray(projectPanels, updatedPanel)
				);
			}
		}
		this.deps.patchAgentPanelInWorkspace(updatedPanel);
	}

	private insertTopLevelAgentPanel(panel: Panel, placement: "prepend" | "append"): void {
		if (panel.sessionId !== null) {
			const canonicalSessionId = this.resolveOpenSessionId(panel.sessionId);
			const incumbent = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
			if (incumbent !== undefined) {
				this.deps.onExistingSessionOpened(incumbent);
				return;
			}
		}

		this.topLevelAgentPanelsById.set(panel.id, panel);
		this.topLevelAgentPanelRefs.set(panel.id, createReactiveValue(panel));
		if (panel.sessionId !== null) {
			const canonicalSessionId = this.resolveOpenSessionId(panel.sessionId);
			this.topLevelAgentPanelBySessionId.set(canonicalSessionId, panel);
		}
		if (panel.projectPath !== null) {
			const projectPanels = this.topLevelAgentPanelsByProject.get(panel.projectPath) ?? [];
			this.topLevelAgentPanelsByProject.set(
				panel.projectPath,
				placement === "prepend"
					? createPrependedItemArray(panel, projectPanels)
					: createAppendedItemArray(projectPanels, panel)
			);
		}

		this.topLevelAgentPanelList =
			placement === "prepend"
				? createPrependedItemArray(panel, this.topLevelAgentPanelList)
				: createAppendedItemArray(this.topLevelAgentPanelList, panel);
		this.deps.insertAgentPanelInWorkspace(panel, placement);
	}

	getTopLevelAgentPanel(panelId: string): Panel | undefined {
		return this.topLevelAgentPanelsById.get(panelId);
	}

	getTopLevelAgentPanelsForProject(projectPath: string): readonly Panel[] {
		return this.topLevelAgentPanelsByProject.get(projectPath) ?? [];
	}

	getFirstSessionAgentPanelForProject(projectPath: string): Panel | undefined {
		return this.getTopLevelAgentPanelsForProject(projectPath).find(
			(panel) => panel.sessionId !== null
		);
	}

	getTopLevelAgentPanels(): readonly Panel[] {
		return this.topLevelAgentPanelList;
	}

	getTopLevelAgentPanelRef(panelId: string): ReactiveValue<Panel | null> {
		const existing = this.topLevelAgentPanelRefs.get(panelId);
		if (existing) {
			return existing;
		}
		const ref = createReactiveValue<Panel | null>(
			this.topLevelAgentPanelsById.get(panelId) ?? null
		);
		this.topLevelAgentPanelRefs.set(panelId, ref);
		return ref;
	}

	getTopLevelAgentPanelIds(): string[] {
		return this.topLevelAgentPanelList.map((panel) => panel.id);
	}

	getTopLevelAgentPanelProjectRefs(): Array<{
		readonly id: string;
		readonly sessionProjectPath: string | null;
		readonly sessionSequenceId: number | null;
	}> {
		return this.topLevelAgentPanelList.map((panel) => {
			const sessionIdentity =
				panel.sessionId !== null ? this.deps.getSessionIdentity(panel.sessionId) : undefined;
			const sessionMetadata =
				panel.sessionId !== null ? this.deps.getSessionMetadata(panel.sessionId) : undefined;
			const isPendingCreationSession =
				panel.sessionId !== null &&
				sessionIdentity === undefined &&
				this.deps.hasPendingCreationSession(panel.sessionId);
			return {
				id: panel.id,
				sessionProjectPath:
					panel.sessionId === null || isPendingCreationSession
						? (panel.projectPath ?? null)
						: (sessionIdentity?.projectPath ?? null),
				sessionSequenceId:
					panel.sessionId !== null
						? resolveAgentPanelHeaderSequenceId({
								sessionMetadataSequenceId: sessionMetadata?.sequenceId,
								pendingCreationSequenceId: isPendingCreationSession
									? (this.deps.getPendingCreationSession(panel.sessionId)?.sequenceId ?? null)
									: null,
								hasPendingCreationSession: isPendingCreationSession,
							})
						: null,
			};
		});
	}

	getPanelCore(panelId: string): Panel | undefined {
		return this.topLevelAgentPanelsById.get(panelId);
	}

	getPanelBySessionId(sessionId: string): Panel | undefined {
		const canonicalSessionId = this.deps.resolveCanonicalSessionId(sessionId);
		if (canonicalSessionId !== null) {
			return this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
		}
		return this.topLevelAgentPanelBySessionId.get(sessionId);
	}

	isSessionOpen(sessionId: string): boolean {
		return this.getPanelBySessionId(sessionId) !== undefined;
	}

	private resolveOpenSessionId(requestedId: string): string {
		const canonicalId = this.deps.resolveCanonicalSessionId(requestedId);
		return canonicalId ?? requestedId;
	}

	private collapseDuplicatePanel(duplicatePanelId: string, incumbent: Panel): void {
		this.deps.onDuplicatePanelDisposed?.(duplicatePanelId);
		this.removeAgentPanel(duplicatePanelId);
		this.deps.onExistingSessionOpened(incumbent);
	}

	private claimOpeningSessionIds(requestedId: string, canonicalId: string): boolean {
		if (this.openingSessionIds.has(canonicalId)) {
			return false;
		}
		if (requestedId !== canonicalId && this.openingSessionIds.has(requestedId)) {
			return false;
		}
		this.openingSessionIds.add(canonicalId);
		if (requestedId !== canonicalId) {
			this.openingSessionIds.add(requestedId);
		}
		return true;
	}

	private releaseOpeningSessionIds(requestedId: string, canonicalId: string): void {
		this.openingSessionIds.delete(canonicalId);
		if (requestedId !== canonicalId) {
			this.openingSessionIds.delete(requestedId);
		}
	}

	clearOpeningSessionId(sessionId: string): void {
		this.openingSessionIds.delete(sessionId);
	}

	removeAgentPanel(panelId: string): Panel | null {
		const panel = this.topLevelAgentPanelsById.get(panelId);
		if (panel === undefined) {
			return null;
		}
		if (!this.panels.some((candidate) => candidate.id === panelId)) {
			return null;
		}
		this.panels = this.panels.filter((candidate) => candidate.id !== panelId);
		return panel;
	}

	private createSessionPanel(sessionId: string, width: number, autoCreated: boolean): Panel {
		const sessionIdentity = this.deps.getSessionIdentity(sessionId);
		const sessionMetadata = this.deps.getSessionMetadata(sessionId);

		return {
			id: crypto.randomUUID(),
			kind: "agent",
			ownerPanelId: null,
			sessionId,
			autoCreated,
			width,
			pendingProjectSelection: false,
			pendingWorktreeEnabled: null,
			preparedWorktreeLaunch: null,
			selectedAgentId: sessionIdentity?.agentId ?? null,
			projectPath: sessionIdentity?.projectPath ?? null,
			agentId: sessionIdentity?.agentId ?? null,
			sourcePath: sessionMetadata?.sourcePath ?? null,
			worktreePath: sessionIdentity?.worktreePath ?? null,
			sessionTitle: sessionMetadata?.title ?? null,
		};
	}

	private setPanelAutoCreated(panelId: string, autoCreated: boolean): Panel | null {
		const panel = this.topLevelAgentPanelsById.get(panelId);
		if (panel === undefined) {
			return null;
		}
		const updatedPanel: Panel = {
			id: panel.id,
			kind: panel.kind,
			ownerPanelId: panel.ownerPanelId,
			sessionId: panel.sessionId,
			autoCreated,
			width: panel.width,
			pendingProjectSelection: panel.pendingProjectSelection,
			pendingWorktreeEnabled: panel.pendingWorktreeEnabled ?? null,
			preparedWorktreeLaunch: panel.preparedWorktreeLaunch ?? null,
			selectedAgentId: panel.selectedAgentId,
			projectPath: panel.projectPath,
			agentId: panel.agentId,
			sourcePath: panel.sourcePath,
			worktreePath: panel.worktreePath,
			sessionTitle: panel.sessionTitle,
		};
		this.patchTopLevelAgentPanel(updatedPanel);
		return updatedPanel;
	}

	openSession(sessionId: string, width: number): Panel | null {
		const t0 = performance.now();
		const canonicalSessionId = this.resolveOpenSessionId(sessionId);
		this.deps.clearAutoSessionSuppression(sessionId);
		if (canonicalSessionId !== sessionId) {
			this.deps.clearAutoSessionSuppression(canonicalSessionId);
		}

		let existing = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
		if (existing) {
			if (existing.autoCreated === true) {
				const promoted = this.setPanelAutoCreated(existing.id, false);
				if (promoted) {
					existing = promoted;
				}
			}
			this.deps.onExistingSessionOpened(existing);
			return existing;
		}

		if (!this.claimOpeningSessionIds(sessionId, canonicalSessionId)) {
			logger.debug("Panel already being opened, skipping duplicate", {
				sessionId,
				canonicalSessionId,
			});
			return null;
		}

		const panel = this.createSessionPanel(canonicalSessionId, width, false);

		this.insertTopLevelAgentPanel(panel, "prepend");
		this.deps.focusOpenedTopLevelPanel(panel.id);
		this.deps.onPersist();

		queueMicrotask(() => {
			this.releaseOpeningSessionIds(sessionId, canonicalSessionId);
		});

		logger.debug("[PERF] openSession: panel added to store", {
			sessionId,
			canonicalSessionId,
			panelId: panel.id,
			elapsed_ms: Math.round(performance.now() - t0),
		});
		return panel;
	}

	materializeSessionPanel(sessionId: string, width: number): Panel | null {
		const canonicalSessionId = this.resolveOpenSessionId(sessionId);
		const existing = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
		if (existing) {
			return existing;
		}

		if (!this.claimOpeningSessionIds(sessionId, canonicalSessionId)) {
			logger.debug("Panel already being opened, skipping duplicate background materialization", {
				sessionId,
				canonicalSessionId,
			});
			return null;
		}

		const panel = this.createSessionPanel(canonicalSessionId, width, true);
		this.insertTopLevelAgentPanel(panel, "append");
		this.deps.onPersist();

		queueMicrotask(() => {
			this.releaseOpeningSessionIds(sessionId, canonicalSessionId);
		});

		logger.debug("Materialized session panel in background", {
			sessionId,
			canonicalSessionId,
			panelId: panel.id,
		});
		return panel;
	}

	spawnPanel(
		options: {
			requireProjectSelection?: boolean;
			projectPath?: string;
			id?: string;
			selectedAgentId?: string | null;
			pendingWorktreeEnabled?: boolean | null;
		} = {}
	): Panel {
		const panel: Panel = {
			id: options.id ?? crypto.randomUUID(),
			kind: "agent",
			ownerPanelId: null,
			sessionId: null,
			width: DEFAULT_PANEL_WIDTH,
			pendingProjectSelection: options.requireProjectSelection ?? false,
			pendingWorktreeEnabled:
				options.pendingWorktreeEnabled === true
					? true
					: options.pendingWorktreeEnabled === false
						? false
						: null,
			preparedWorktreeLaunch: null,
			selectedAgentId: options.selectedAgentId ?? null,
			projectPath: options.projectPath ?? null,
			agentId: null,
			sourcePath: null,
			worktreePath: null,
			sessionTitle: null,
		};

		this.panels = [panel, ...this.panels];
		this.deps.onSpawnedPanelFocused(panel);
		this.deps.onPersist();

		logger.debug("Spawned new panel", { panelId: panel.id });
		return panel;
	}

	updatePanelSession(panelId: string, sessionId: string | null): void {
		logger.info("[worktree-flow] updatePanelSession", { panelId, sessionId });
		if (sessionId !== null) {
			const canonicalSessionId = this.resolveOpenSessionId(sessionId);
			const incumbent = this.topLevelAgentPanelBySessionId.get(canonicalSessionId);
			if (incumbent !== undefined && incumbent.id !== panelId) {
				this.collapseDuplicatePanel(panelId, incumbent);
				return;
			}
			sessionId = canonicalSessionId;
		}
		const sessionIdentity =
			sessionId !== null ? this.deps.getSessionIdentity(sessionId) : undefined;
		const sessionMetadata =
			sessionId !== null ? this.deps.getSessionMetadata(sessionId) : undefined;
		const isPendingCreationSession =
			sessionId !== null &&
			sessionIdentity === undefined &&
			this.deps.hasPendingCreationSession(sessionId);
		logger.info("[worktree-debug] updatePanelSession resolved session", {
			panelId,
			sessionId,
			sessionProjectPath: sessionIdentity?.projectPath ?? null,
			sessionWorktreePath: sessionIdentity?.worktreePath ?? null,
			panelProjectPathBefore:
				this.panels.find((panel) => panel.id === panelId)?.projectPath ?? null,
		});
		this.panels = this.panels.map((panel) =>
			panel.id === panelId
				? {
						id: panel.id,
						kind: panel.kind,
						ownerPanelId: panel.ownerPanelId,
						sessionId,
						autoCreated: panel.autoCreated,
						width: panel.width,
						pendingProjectSelection: false,
						pendingWorktreeEnabled:
							sessionId === null ? (panel.pendingWorktreeEnabled ?? null) : null,
						preparedWorktreeLaunch:
							sessionId === null ? (panel.preparedWorktreeLaunch ?? null) : null,
						selectedAgentId: panel.selectedAgentId,
						projectPath:
							sessionId === null || isPendingCreationSession
								? panel.projectPath
								: (sessionIdentity?.projectPath ?? null),
						agentId:
							sessionId === null || isPendingCreationSession
								? (panel.agentId ?? panel.selectedAgentId)
								: (sessionIdentity?.agentId ?? null),
						sourcePath:
							sessionId === null || isPendingCreationSession
								? panel.sourcePath
								: (sessionMetadata?.sourcePath ?? null),
						worktreePath:
							sessionId === null || isPendingCreationSession
								? panel.worktreePath
								: (sessionIdentity?.worktreePath ?? null),
						sessionTitle:
							sessionId === null || isPendingCreationSession
								? panel.sessionTitle
								: (sessionMetadata?.title ?? null),
					}
				: panel
		);
		logger.info("[worktree-debug] updatePanelSession applied", {
			panelId,
			sessionId,
			panelProjectPathAfter: this.panels.find((panel) => panel.id === panelId)?.projectPath ?? null,
		});
		this.deps.onPersist();
	}

	resizePanel(panelId: string, delta: number): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId
				? { ...panel, width: Math.max(panel.width + delta, MIN_PANEL_WIDTH) }
				: panel
		);
		this.deps.onPersist();
	}

	setPanelAgent(panelId: string, agentId: string | null): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId ? { ...panel, selectedAgentId: agentId } : panel
		);
		this.deps.onPersist();
		logger.debug("Panel agent set", { panelId, agentId });
	}

	setPanelProjectPath(panelId: string, projectPath: string): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId ? { ...panel, projectPath, pendingProjectSelection: false } : panel
		);
		this.deps.onPersist();
		logger.debug("Panel project path set", { panelId, projectPath });
	}

	setPendingWorktreeEnabled(panelId: string, pendingWorktreeEnabled: boolean): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId ? { ...panel, pendingWorktreeEnabled } : panel
		);
		this.deps.onPersist();
		logger.debug("Panel pending worktree state set", { panelId, pendingWorktreeEnabled });
	}

	setPreparedWorktreeLaunch(panelId: string, preparedWorktreeLaunch: PreparedWorktreeLaunch): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId ? { ...panel, preparedWorktreeLaunch } : panel
		);
		this.deps.onPersist();
		logger.debug("Panel prepared worktree launch set", {
			panelId,
			launchToken: preparedWorktreeLaunch.launchToken,
			sequenceId: preparedWorktreeLaunch.sequenceId,
		});
	}

	clearPreparedWorktreeLaunch(panelId: string): void {
		this.panels = this.panels.map((panel) =>
			panel.id === panelId ? { ...panel, preparedWorktreeLaunch: null } : panel
		);
		this.deps.onPersist();
		logger.debug("Panel prepared worktree launch cleared", { panelId });
	}

	movePanelToFront(panelId: string): void {
		const index = this.panels.findIndex((panel) => panel.id === panelId);
		if (index <= 0) return;
		const panel = this.panels[index];
		this.panels = [panel, ...this.panels.slice(0, index), ...this.panels.slice(index + 1)];
		this.deps.onPersist();
	}

	clearAllAgentPanels(): void {
		this.panels = [];
	}
}
