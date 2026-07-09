/**
 * PanelReviewState — the review-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns review panel indexes, pending workspace-restore file-index markers, and the methods
 * that mutate them. Cross-slice workspace chrome flows through accessor-closure dependencies;
 * the parent `PanelStore` holds one instance and delegates its review-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import type { ModifiedFilesState } from "../types/modified-files-state.js";
import { createLogger } from "../utils/logger.js";
import type { ReviewPanel } from "./review-panel-type.js";
import { DEFAULT_REVIEW_PANEL_WIDTH, MIN_REVIEW_PANEL_WIDTH } from "./review-panel-type.js";
import type { TopLevelPanelCloseState } from "./panel-terminal-state.svelte.js";
import type { WorkspacePanel, WorkspacePanelKind } from "./types.js";

const logger = createLogger({ id: "panel-review-state", name: "PanelReviewState" });

export interface PanelReviewStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	focusOpenedTopLevelPanel: (panelId: string) => void;
	onPersist: () => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelReviewState {
	private reviewPanelByIdIndex = new SvelteMap<string, ReviewPanel>();
	private reviewPanelByProjectPath = new SvelteMap<string, ReviewPanel>();

	readonly reviewPanelById = $derived.by(() => this.reviewPanelByIdIndex);
	readonly reviewPanelCount = $derived(this.reviewPanelByIdIndex.size);

	constructor(private readonly deps: PanelReviewStateDeps) {}

	get reviewPanels(): ReviewPanel[] {
		return this.deps
			.getWorkspacePanels()
			.filter((panel): panel is ReviewPanel => panel.kind === "review");
	}

	set reviewPanels(nextPanels: ReviewPanel[]) {
		this.syncReviewPanelIndexes(nextPanels);
		this.replaceWorkspacePanels("review", nextPanels);
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

	syncReviewPanelIndexes(nextPanels: readonly ReviewPanel[]): void {
		this.reviewPanelByIdIndex.clear();
		this.reviewPanelByProjectPath.clear();
		for (const panel of nextPanels) {
			this.reviewPanelByIdIndex.set(panel.id, panel);
			this.reviewPanelByProjectPath.set(panel.projectPath, panel);
		}
	}

	openReviewPanel(
		projectPath: string,
		modifiedFilesState: ModifiedFilesState,
		initialFileIndex?: number,
		width?: number
	): ReviewPanel {
		const existing = this.reviewPanelByProjectPath.get(projectPath);
		if (existing) {
			this.deps.focusOpenedTopLevelPanel(existing.id);
			logger.debug("Review panel already open, returning existing", { projectPath });
			return existing;
		}

		const panel: ReviewPanel = {
			id: crypto.randomUUID(),
			kind: "review",
			projectPath,
			width: width ?? DEFAULT_REVIEW_PANEL_WIDTH,
			ownerPanelId: null,
			modifiedFilesState,
			selectedFileIndex: initialFileIndex ?? 0,
		};

		this.reviewPanels = [panel, ...this.reviewPanels];
		this.deps.focusOpenedTopLevelPanel(panel.id);
		this.deps.onPersist();

		logger.debug("Opened review panel", { projectPath, panelId: panel.id });
		return panel;
	}

	closeReviewPanel(panelId: string): void {
		const closeState = this.deps.captureTopLevelPanelCloseState(panelId);
		this.reviewPanels = this.reviewPanels.filter((panel) => panel.id !== panelId);
		this.deps.applyTopLevelPanelCloseState(closeState);
		this.deps.onPersist();
		logger.debug("Closed review panel", { panelId });
	}

	updateReviewPanelFileIndex(panelId: string, fileIndex: number): void {
		this.reviewPanels = this.reviewPanels.map((panel) =>
			panel.id === panelId ? { ...panel, selectedFileIndex: fileIndex } : panel
		);
	}

	updateReviewPanelState(panelId: string, modifiedFilesState: ModifiedFilesState): void {
		this.reviewPanels = this.reviewPanels.map((panel) =>
			panel.id === panelId ? { ...panel, modifiedFilesState } : panel
		);
	}

	resizeReviewPanel(panelId: string, delta: number): void {
		this.reviewPanels = this.reviewPanels.map((panel) =>
			panel.id === panelId
				? { ...panel, width: Math.max(panel.width + delta, MIN_REVIEW_PANEL_WIDTH) }
				: panel
		);
		this.deps.onPersist();
	}

	getReviewPanel(panelId: string): ReviewPanel | undefined {
		return this.reviewPanelByIdIndex.get(panelId);
	}

	getReviewPanelByProjectPath(projectPath: string): ReviewPanel | undefined {
		return this.reviewPanelByProjectPath.get(projectPath);
	}
}
