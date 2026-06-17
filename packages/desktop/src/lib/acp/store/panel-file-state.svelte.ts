/**
 * PanelFileState — the file-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns file panel indexes, owner-attachment maps, active-id tracking, and the methods
 * that mutate them. Cross-slice workspace chrome and owner-panel width policy flow through
 * accessor-closure dependencies; the parent `PanelStore` holds one instance and delegates
 * its file-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import {
	createFilePanelCacheKey,
	normalizeOpenFilePanelOptions,
	type OpenFilePanelOptions,
} from "./file-panel-ownership.js";
import type { FilePanel } from "./file-panel-type.js";
import { DEFAULT_FILE_PANEL_WIDTH, MIN_FILE_PANEL_WIDTH } from "./file-panel-type.js";
import {
	createPrependedItemArray,
	createRemovedItemArray,
} from "./panel-store-array-patches.js";
import { areFilePanelListsEqual } from "./panel-store-equality.js";
import type { TopLevelPanelCloseState } from "./panel-terminal-state.svelte.js";
import { createLogger } from "../utils/logger.js";
import type { Panel, WorkspacePanel, WorkspacePanelKind } from "./types.js";
import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./types.js";

const logger = createLogger({ id: "panel-file-state", name: "PanelFileState" });
const DEFAULT_ATTACHED_FILE_PANEL_WIDTH = DEFAULT_FILE_PANEL_WIDTH;

export interface PanelFileStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	prependWorkspacePanel: (panel: WorkspacePanel) => void;
	removeWorkspacePanelById: (panelId: string) => void;
	getOwnerPanel: (ownerPanelId: string) => Panel | undefined;
	patchOwnerPanel: (updatedPanel: Panel) => void;
	focusOpenedTopLevelPanel: (panelId: string) => void;
	onPersist: () => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelFileState {
	private attachedFilePanelsByOwnerPanelId = new SvelteMap<string, FilePanel[]>();
	private filePanelsByProject = new SvelteMap<string, FilePanel[]>();
	private filePanelByCacheKey = new SvelteMap<string, FilePanel>();
	private filePanelById = new SvelteMap<string, FilePanel>();
	private activeFilePanelIdByOwnerPanelId = new SvelteMap<string, string>();
	private activeTopLevelFilePanelIdByProject = new SvelteMap<string, string>();
	private pendingOwnerPanelWidthEnsures = new Map<string, number>();
	private pendingFilePanelPersist: ReturnType<typeof setTimeout> | null = null;

	filePanelList = $state<FilePanel[]>([]);
	topLevelFilePanelsList = $state<FilePanel[]>([]);
	topLevelFilePanelsByProject = new SvelteMap<string, FilePanel[]>();

	readonly filePanelByPath = $derived.by(() => this.filePanelByCacheKey);
	readonly filePanelCount = $derived(this.filePanelById.size);

	constructor(private readonly deps: PanelFileStateDeps) {}

	get filePanels(): FilePanel[] {
		return this.filePanelList;
	}

	set filePanels(nextPanels: FilePanel[]) {
		this.syncFilePanelIndexes(nextPanels);
		this.replaceWorkspacePanels("file", nextPanels);
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

	private ensureOwnerPanelWidth(ownerPanelId: string, attachedWidth: number): boolean {
		const requiredWidth = Math.max(MIN_PANEL_WIDTH, attachedWidth);
		const ownerPanel = this.deps.getOwnerPanel(ownerPanelId);
		if (ownerPanel === undefined || ownerPanel.width >= requiredWidth) {
			return false;
		}
		this.deps.patchOwnerPanel({ ...ownerPanel, width: requiredWidth });
		return true;
	}

	private scheduleOwnerPanelWidthEnsure(ownerPanelId: string, attachedWidth: number): void {
		const requiredWidth = Math.max(MIN_PANEL_WIDTH, attachedWidth);
		const ownerPanel = this.deps.getOwnerPanel(ownerPanelId);
		if (ownerPanel === undefined || ownerPanel.width >= requiredWidth) {
			return;
		}

		const previousWidth = this.pendingOwnerPanelWidthEnsures.get(ownerPanelId) ?? 0;
		this.pendingOwnerPanelWidthEnsures.set(ownerPanelId, Math.max(previousWidth, attachedWidth));
		if (previousWidth > 0) {
			return;
		}

		setTimeout(() => {
			const pendingWidth = this.pendingOwnerPanelWidthEnsures.get(ownerPanelId);
			this.pendingOwnerPanelWidthEnsures.delete(ownerPanelId);
			if (pendingWidth === undefined) {
				return;
			}
			if (this.ensureOwnerPanelWidth(ownerPanelId, pendingWidth)) {
				this.deps.onPersist();
			}
		}, 0);
	}

	private resetOwnerPanelWidthIfNoAttached(ownerPanelId: string): void {
		const hasAttachedPanels =
			(this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId)?.length ?? 0) > 0;
		if (hasAttachedPanels) return;
		const ownerPanel = this.deps.getOwnerPanel(ownerPanelId);
		if (ownerPanel === undefined || ownerPanel.width === DEFAULT_PANEL_WIDTH) {
			return;
		}
		this.deps.patchOwnerPanel({ ...ownerPanel, width: DEFAULT_PANEL_WIDTH });
	}

	private removeFilePanelFromIndexes(panel: FilePanel): void {
		this.filePanelById.delete(panel.id);
		this.filePanelByCacheKey.delete(
			createFilePanelCacheKey(panel.filePath, panel.projectPath, panel.ownerPanelId)
		);
		this.filePanelList = createRemovedItemArray(this.filePanelList, panel.id);

		const projectPanels = this.filePanelsByProject.get(panel.projectPath);
		if (projectPanels !== undefined) {
			const nextProjectPanels = createRemovedItemArray(projectPanels, panel.id);
			if (nextProjectPanels.length === 0) {
				this.filePanelsByProject.delete(panel.projectPath);
			} else {
				this.filePanelsByProject.set(panel.projectPath, nextProjectPanels);
			}
		}

		if (panel.ownerPanelId === null) {
			this.topLevelFilePanelsList = createRemovedItemArray(this.topLevelFilePanelsList, panel.id);
			const topLevelProjectPanels = this.topLevelFilePanelsByProject.get(panel.projectPath);
			if (topLevelProjectPanels !== undefined) {
				const nextTopLevelProjectPanels = createRemovedItemArray(topLevelProjectPanels, panel.id);
				if (nextTopLevelProjectPanels.length === 0) {
					this.topLevelFilePanelsByProject.delete(panel.projectPath);
				} else {
					this.topLevelFilePanelsByProject.set(panel.projectPath, nextTopLevelProjectPanels);
				}
			}
		} else {
			const attachedPanels = this.attachedFilePanelsByOwnerPanelId.get(panel.ownerPanelId);
			if (attachedPanels !== undefined) {
				const nextAttachedPanels = createRemovedItemArray(attachedPanels, panel.id);
				if (nextAttachedPanels.length === 0) {
					this.attachedFilePanelsByOwnerPanelId.delete(panel.ownerPanelId);
				} else {
					this.attachedFilePanelsByOwnerPanelId.set(panel.ownerPanelId, nextAttachedPanels);
				}
			}
		}

		this.deps.removeWorkspacePanelById(panel.id);
	}

	syncFilePanelIndexes(nextPanels: readonly FilePanel[]): void {
		if (!areFilePanelListsEqual(this.filePanelList, nextPanels)) {
			this.filePanelList = Array.from(nextPanels);
		}
		this.filePanelByCacheKey.clear();
		this.filePanelById.clear();
		const groupedPanels = new Map<string, FilePanel[]>();
		const projectGroupedPanels = new Map<string, FilePanel[]>();
		const topLevelPanels: FilePanel[] = [];
		const topLevelGroupedPanels = new Map<string, FilePanel[]>();
		for (const panel of nextPanels) {
			this.filePanelById.set(panel.id, panel);
			this.filePanelByCacheKey.set(
				createFilePanelCacheKey(panel.filePath, panel.projectPath, panel.ownerPanelId),
				panel
			);
			const projectExisting = projectGroupedPanels.get(panel.projectPath);
			if (projectExisting) {
				projectExisting.push(panel);
			} else {
				projectGroupedPanels.set(panel.projectPath, [panel]);
			}
			if (panel.ownerPanelId === null) {
				topLevelPanels.push(panel);
				const topLevelExisting = topLevelGroupedPanels.get(panel.projectPath);
				if (topLevelExisting) {
					topLevelExisting.push(panel);
				} else {
					topLevelGroupedPanels.set(panel.projectPath, [panel]);
				}
				continue;
			}
			const existing = groupedPanels.get(panel.ownerPanelId);
			if (existing) {
				existing.push(panel);
			} else {
				groupedPanels.set(panel.ownerPanelId, [panel]);
			}
		}
		for (const ownerPanelId of this.attachedFilePanelsByOwnerPanelId.keys()) {
			if (!groupedPanels.has(ownerPanelId)) {
				this.attachedFilePanelsByOwnerPanelId.delete(ownerPanelId);
			}
		}
		for (const [ownerPanelId, panels] of groupedPanels.entries()) {
			const current = this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId);
			if (!areFilePanelListsEqual(current, panels)) {
				this.attachedFilePanelsByOwnerPanelId.set(ownerPanelId, panels);
			}
		}

		for (const projectPath of this.filePanelsByProject.keys()) {
			if (!projectGroupedPanels.has(projectPath)) {
				this.filePanelsByProject.delete(projectPath);
			}
		}
		for (const [projectPath, panels] of projectGroupedPanels.entries()) {
			const current = this.filePanelsByProject.get(projectPath);
			if (!areFilePanelListsEqual(current, panels)) {
				this.filePanelsByProject.set(projectPath, panels);
			}
		}

		if (!areFilePanelListsEqual(this.topLevelFilePanelsList, topLevelPanels)) {
			this.topLevelFilePanelsList = topLevelPanels;
		}
		for (const projectPath of this.topLevelFilePanelsByProject.keys()) {
			if (!topLevelGroupedPanels.has(projectPath)) {
				this.topLevelFilePanelsByProject.delete(projectPath);
			}
		}
		for (const [projectPath, panels] of topLevelGroupedPanels.entries()) {
			const current = this.topLevelFilePanelsByProject.get(projectPath);
			if (!areFilePanelListsEqual(current, panels)) {
				this.topLevelFilePanelsByProject.set(projectPath, panels);
			}
		}
	}

	private prependFilePanel(panel: FilePanel): void {
		this.filePanelById.set(panel.id, panel);
		this.filePanelByCacheKey.set(
			createFilePanelCacheKey(panel.filePath, panel.projectPath, panel.ownerPanelId),
			panel
		);
		this.filePanelsByProject.set(
			panel.projectPath,
			createPrependedItemArray(panel, this.filePanelsByProject.get(panel.projectPath) ?? [])
		);
		this.filePanelList = createPrependedItemArray(panel, this.filePanelList);

		if (panel.ownerPanelId === null) {
			this.topLevelFilePanelsList = createPrependedItemArray(panel, this.topLevelFilePanelsList);
			this.topLevelFilePanelsByProject.set(
				panel.projectPath,
				createPrependedItemArray(
					panel,
					this.topLevelFilePanelsByProject.get(panel.projectPath) ?? []
				)
			);
		} else {
			this.attachedFilePanelsByOwnerPanelId.set(
				panel.ownerPanelId,
				createPrependedItemArray(
					panel,
					this.attachedFilePanelsByOwnerPanelId.get(panel.ownerPanelId) ?? []
				)
			);
		}

		this.deps.prependWorkspacePanel(panel);
	}

	private scheduleFilePanelPersist(): void {
		if (this.pendingFilePanelPersist !== null) {
			return;
		}
		this.pendingFilePanelPersist = setTimeout(() => {
			this.pendingFilePanelPersist = null;
			this.deps.onPersist();
		}, 0);
	}

	getTopLevelFilePanelForLookup(panelId: string): FilePanel | undefined {
		const filePanel = this.filePanelById.get(panelId);
		if (filePanel?.ownerPanelId === null) {
			return filePanel;
		}
		return undefined;
	}

	getAttachedFilePanelsForOwner(ownerPanelId: string): FilePanel[] {
		return this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId) ?? [];
	}

	onOwnerPanelClosed(ownerPanelId: string): void {
		this.activeFilePanelIdByOwnerPanelId.delete(ownerPanelId);
		this.filePanels = this.filePanels.filter((filePanel) => filePanel.ownerPanelId !== ownerPanelId);
	}

	clearAttachedFilePanelState(): void {
		this.filePanels = this.filePanels.filter((panel) => panel.ownerPanelId === null);
		this.activeFilePanelIdByOwnerPanelId = new SvelteMap();
	}

	openFilePanel(
		filePath: string,
		projectPath: string,
		options?: OpenFilePanelOptions | number
	): FilePanel {
		const normalizedOptions = normalizeOpenFilePanelOptions(options);
		const ownerPanelId = normalizedOptions?.ownerPanelId ?? null;
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, ownerPanelId);

		const existing = this.filePanelByCacheKey.get(cacheKey);
		if (existing) {
			if (ownerPanelId !== null) {
				this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, existing.id);
				this.scheduleOwnerPanelWidthEnsure(ownerPanelId, existing.width);
			} else {
				this.activeTopLevelFilePanelIdByProject.set(projectPath, existing.id);
				this.deps.focusOpenedTopLevelPanel(existing.id);
			}
			logger.debug("File already open, focusing existing panel", { filePath, projectPath });
			return existing;
		}

		const panel: FilePanel = {
			id: crypto.randomUUID(),
			kind: "file",
			filePath,
			projectPath,
			ownerPanelId,
			...(normalizedOptions?.targetLine !== undefined
				? { targetLine: normalizedOptions.targetLine }
				: {}),
			...(normalizedOptions?.targetColumn !== undefined
				? { targetColumn: normalizedOptions.targetColumn }
				: {}),
			width:
				normalizedOptions?.width ??
				(ownerPanelId !== null ? DEFAULT_ATTACHED_FILE_PANEL_WIDTH : DEFAULT_FILE_PANEL_WIDTH),
		};

		this.prependFilePanel(panel);
		if (ownerPanelId !== null) {
			this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, panel.id);
			this.scheduleOwnerPanelWidthEnsure(ownerPanelId, panel.width);
		} else {
			this.activeTopLevelFilePanelIdByProject.set(projectPath, panel.id);
			this.deps.focusOpenedTopLevelPanel(panel.id);
		}
		this.scheduleFilePanelPersist();

		logger.debug("Opened file in panel", { filePath, projectPath, panelId: panel.id });
		return panel;
	}

	closeFilePanel(panelId: string): void {
		const panelToClose = this.filePanelById.get(panelId);
		if (panelToClose === undefined) {
			return;
		}
		const closeState =
			panelToClose.ownerPanelId === null
				? this.deps.captureTopLevelPanelCloseState(panelId)
				: null;
		this.removeFilePanelFromIndexes(panelToClose);
		if (panelToClose.ownerPanelId) {
			const ownerPanelId = panelToClose.ownerPanelId;
			const activePanelId = this.activeFilePanelIdByOwnerPanelId.get(panelToClose.ownerPanelId);
			if (activePanelId === panelId) {
				const replacementId =
					this.attachedFilePanelsByOwnerPanelId.get(panelToClose.ownerPanelId)?.[0]?.id ??
					null;
				if (replacementId) {
					this.activeFilePanelIdByOwnerPanelId.set(panelToClose.ownerPanelId, replacementId);
				} else {
					this.activeFilePanelIdByOwnerPanelId.delete(panelToClose.ownerPanelId);
				}
			}
			this.resetOwnerPanelWidthIfNoAttached(ownerPanelId);
		} else if (panelToClose.ownerPanelId === null) {
			const projectPath = panelToClose.projectPath;
			const activeId = this.activeTopLevelFilePanelIdByProject.get(projectPath);
			if (activeId === panelId) {
				const remaining = this.topLevelFilePanelsByProject.get(projectPath)?.[0] ?? null;
				if (remaining) {
					this.activeTopLevelFilePanelIdByProject.set(projectPath, remaining.id);
				} else {
					this.activeTopLevelFilePanelIdByProject.delete(projectPath);
				}
			}
		}
		if (closeState) {
			this.deps.applyTopLevelPanelCloseState(closeState);
		}
		this.deps.onPersist();
		logger.debug("Closed file panel", { panelId });
	}

	isFileOpen(filePath: string, projectPath: string): boolean {
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, null);
		return this.filePanelByCacheKey.has(cacheKey);
	}

	resizeFilePanel(panelId: string, delta: number): void {
		let resizedAttachedOwnerPanelId: string | null = null;
		let resizedWidth = 0;
		this.filePanels = this.filePanels.map((p) => {
			if (p.id !== panelId) return p;
			const nextWidth = Math.max(p.width + delta, MIN_FILE_PANEL_WIDTH);
			if (p.ownerPanelId !== null) {
				resizedAttachedOwnerPanelId = p.ownerPanelId;
				resizedWidth = nextWidth;
			}
			return {
				id: p.id,
				kind: p.kind,
				filePath: p.filePath,
				projectPath: p.projectPath,
				ownerPanelId: p.ownerPanelId,
				width: nextWidth,
				targetLine: p.targetLine,
				targetColumn: p.targetColumn,
			};
		});
		if (resizedAttachedOwnerPanelId !== null) {
			this.ensureOwnerPanelWidth(resizedAttachedOwnerPanelId, resizedWidth);
		}
		this.deps.onPersist();
	}

	getFilePanel(panelId: string): FilePanel | undefined {
		return this.filePanelById.get(panelId);
	}

	getFilePanelByPath(filePath: string, projectPath: string): FilePanel | undefined {
		const cacheKey = createFilePanelCacheKey(filePath, projectPath, null);
		return this.filePanelByCacheKey.get(cacheKey);
	}

	getFilePanelsForProject(projectPath: string): FilePanel[] {
		return this.filePanelsByProject.get(projectPath) ?? [];
	}

	getAttachedFilePanels(ownerPanelId: string): FilePanel[] {
		return this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId) ?? [];
	}

	hasAttachedFilePanels(ownerPanelId: string): boolean {
		return (this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId)?.length ?? 0) > 0;
	}

	getActiveFilePanelId(ownerPanelId: string): string | null {
		return this.activeFilePanelIdByOwnerPanelId.get(ownerPanelId) ?? null;
	}

	getActiveAttachedFilePanel(ownerPanelId: string): FilePanel | null {
		const activeFilePanelId = this.activeFilePanelIdByOwnerPanelId.get(ownerPanelId);
		if (activeFilePanelId) {
			const panel = this.filePanelById.get(activeFilePanelId);
			if (panel?.ownerPanelId === ownerPanelId) {
				return panel;
			}
		}
		return this.attachedFilePanelsByOwnerPanelId.get(ownerPanelId)?.[0] ?? null;
	}

	setActiveAttachedFilePanel(ownerPanelId: string, filePanelId: string): void {
		const target = this.filePanelById.get(filePanelId);
		if (target?.ownerPanelId !== ownerPanelId) return;
		this.activeFilePanelIdByOwnerPanelId.set(ownerPanelId, filePanelId);
		this.scheduleFilePanelPersist();
	}

	getActiveTopLevelFilePanelId(projectPath: string): string | null {
		return this.activeTopLevelFilePanelIdByProject.get(projectPath) ?? null;
	}

	getTopLevelFilePanels(): FilePanel[] {
		return this.topLevelFilePanelsList;
	}

	setActiveTopLevelFilePanel(projectPath: string, filePanelId: string): void {
		const target = this.filePanelById.get(filePanelId);
		if (!target || target.ownerPanelId !== null || target.projectPath !== projectPath) return;
		this.activeTopLevelFilePanelIdByProject.set(projectPath, filePanelId);
		this.scheduleFilePanelPersist();
	}

	getTopLevelFilePanelsForProject(projectPath: string): FilePanel[] {
		return this.topLevelFilePanelsByProject.get(projectPath) ?? [];
	}

	getActiveFilePanelIdByOwnerPanelIdRecord(): Record<string, string> {
		return Object.fromEntries(this.activeFilePanelIdByOwnerPanelId.entries());
	}

	setActiveFilePanelMap(activeMap: Map<string, string>): void {
		this.activeFilePanelIdByOwnerPanelId = new SvelteMap(activeMap);
	}
}
