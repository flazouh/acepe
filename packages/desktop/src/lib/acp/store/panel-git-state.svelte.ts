/**
 * PanelGitState — the git-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns legacy git workspace panels and the methods that mutate them. Cross-slice view
 * chrome flows through accessor-closure dependencies; the parent `PanelStore` holds one
 * instance and delegates its git-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import { createLogger } from "../utils/logger.js";
import type { GitPanel } from "./git-panel-type.js";
import type { TopLevelPanelCloseState } from "./panel-terminal-state.svelte.js";
import type { WorkspacePanel, WorkspacePanelKind } from "./types.js";

const logger = createLogger({ id: "panel-git-state", name: "PanelGitState" });

export interface PanelGitStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	onPersist: () => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelGitState {
	private gitPanelById = new SvelteMap<string, GitPanel>();
	private gitPanelByProjectPathIndex = new SvelteMap<string, GitPanel>();

	readonly gitPanelByProjectPath = $derived.by(() => this.gitPanelByProjectPathIndex);
	readonly gitPanelCount = $derived(this.gitPanelById.size);

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

	closeLegacyGitPanel(panelId: string): void {
		const closeState = this.deps.captureTopLevelPanelCloseState(panelId);
		this.gitPanels = this.gitPanels.filter((panel) => panel.id !== panelId);
		this.deps.applyTopLevelPanelCloseState(closeState);
		this.deps.onPersist();
		logger.debug("Closed legacy git panel", { panelId });
	}
}
