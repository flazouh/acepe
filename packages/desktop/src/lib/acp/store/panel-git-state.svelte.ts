/**
 * PanelGitState — the git-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns legacy git workspace panels, the source-control dialog state, and the methods
 * that mutate them. Cross-slice view chrome flows through accessor-closure dependencies;
 * the parent `PanelStore` holds one instance and delegates its git-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import { createLogger } from "../utils/logger.js";
import { type GitModalPanel, openGitModalPanel } from "./git-modal-state.js";
import type { GitPanel, GitPanelInitialTarget } from "./git-panel-type.js";
import { DEFAULT_GIT_PANEL_WIDTH } from "./git-panel-type.js";
import type { TopLevelPanelCloseState } from "./panel-terminal-state.svelte.js";
import type { ViewMode, WorkspacePanel, WorkspacePanelKind } from "./types.js";

const logger = createLogger({ id: "panel-git-state", name: "PanelGitState" });

export interface GitDialogState extends GitModalPanel {
	initialTarget?: GitPanelInitialTarget;
}

export interface PanelGitStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	onPersist: () => void;
	getViewMode: () => ViewMode;
	setFocusedViewProjectPath: (projectPath: string) => void;
	setScrollX: (scrollX: number) => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelGitState {
	private gitPanelById = new SvelteMap<string, GitPanel>();
	private gitPanelByProjectPathIndex = new SvelteMap<string, GitPanel>();

	readonly gitPanelByProjectPath = $derived.by(() => this.gitPanelByProjectPathIndex);
	readonly gitPanelCount = $derived(this.gitPanelById.size);
	gitDialog = $state<GitDialogState | null>(null);

	constructor(private readonly deps: PanelGitStateDeps) {}

	get gitPanels(): GitPanel[] {
		return this.deps
			.getWorkspacePanels()
			.filter((panel): panel is GitPanel => panel.kind === "git");
	}

	set gitPanels(nextPanels: GitPanel[]) {
		this.syncGitPanelIndexes(nextPanels);
		this.replaceWorkspacePanels("git", nextPanels);
	}

	private replaceWorkspacePanels(
		kind: WorkspacePanelKind,
		nextPanels: readonly WorkspacePanel[]
	): void {
		const remainingPanels = this.deps
			.getWorkspacePanels()
			.filter((panel) => panel.kind !== kind);
		this.deps.setWorkspacePanels(Array.from(nextPanels).concat(remainingPanels));
	}

	syncGitPanelIndexes(nextPanels: readonly GitPanel[]): void {
		this.gitPanelById.clear();
		this.gitPanelByProjectPathIndex.clear();
		for (const panel of nextPanels) {
			this.gitPanelById.set(panel.id, panel);
			this.gitPanelByProjectPathIndex.set(panel.projectPath, panel);
		}
	}

	openGitDialog(
		projectPath: string,
		width?: number,
		initialTarget?: GitPanelInitialTarget
	): GitDialogState {
		const result = openGitModalPanel(
			this.gitDialog ? [this.gitDialog] : [],
			projectPath,
			width ?? DEFAULT_GIT_PANEL_WIDTH,
			() => crypto.randomUUID()
		);

		const activePanelId = result.activePanel.id;
		const nextDialogs = result.panels.map((panel) => {
			const nextInitialTarget =
				panel.id === activePanelId && initialTarget !== undefined
					? initialTarget
					: panel.initialTarget;
			return {
				id: panel.id,
				projectPath: panel.projectPath,
				width: panel.width,
				initialTarget: nextInitialTarget,
			};
		});
		const activeDialog = nextDialogs.find((panel) => panel.id === activePanelId);
		if (!activeDialog) {
			throw new Error(`Missing git dialog after opening ${projectPath}`);
		}

		this.gitDialog = activeDialog;
		if (this.deps.getViewMode() !== "multi") {
			this.deps.setFocusedViewProjectPath(projectPath);
			this.deps.setScrollX(0);
		}
		this.deps.onPersist();

		logger.debug("Opened git dialog", { projectPath, panelId: activeDialog.id });
		return activeDialog;
	}

	closeGitDialog(): void {
		if (this.gitDialog === null) {
			return;
		}
		const panelId = this.gitDialog.id;
		this.gitDialog = null;
		this.deps.onPersist();
		logger.debug("Closed git dialog", { panelId });
	}

	closeLegacyGitPanel(panelId: string): void {
		const closeState = this.deps.captureTopLevelPanelCloseState(panelId);
		this.gitPanels = this.gitPanels.filter((panel) => panel.id !== panelId);
		this.deps.applyTopLevelPanelCloseState(closeState);
		this.deps.onPersist();
		logger.debug("Closed legacy git panel", { panelId });
	}
}
