/**
 * PanelBrowserState — the browser-panel slice of the panel store, extracted as a
 * composed sub-store (see docs/adr/0002-composed-sub-stores-for-reactive-decomposition.md).
 * Owns browser panel indexes and the methods that mutate them. Cross-slice workspace chrome
 * flows through accessor-closure dependencies; the parent `PanelStore` holds one instance
 * and delegates its browser-domain reads/writes here.
 */
import { SvelteMap } from "svelte/reactivity";
import { browserWebview } from "../../utils/tauri-client/browser-webview.js";
import { createLogger } from "../utils/logger.js";
import type { BrowserPanel } from "./browser-panel-type.js";
import { DEFAULT_BROWSER_PANEL_WIDTH, MIN_BROWSER_PANEL_WIDTH } from "./browser-panel-type.js";
import { areBrowserPanelListsEqual } from "./panel-store-equality.js";
import type { TopLevelPanelCloseState } from "./panel-terminal-state.svelte.js";
import type { BrowserWorkspacePanel, WorkspacePanel, WorkspacePanelKind } from "./types.js";

const logger = createLogger({ id: "panel-browser-state", name: "PanelBrowserState" });

export interface PanelBrowserStateDeps {
	getWorkspacePanels: () => WorkspacePanel[];
	setWorkspacePanels: (panels: readonly WorkspacePanel[]) => void;
	focusOpenedTopLevelPanel: (panelId: string) => void;
	onPersist: () => void;
	captureTopLevelPanelCloseState: (closedPanelId: string) => TopLevelPanelCloseState;
	applyTopLevelPanelCloseState: (closeState: TopLevelPanelCloseState) => void;
}

export class PanelBrowserState {
	private browserPanelsByProject = new SvelteMap<string, BrowserPanel[]>();
	private browserPanelById = new SvelteMap<string, BrowserPanel>();

	readonly browserPanelCount = $derived(this.browserPanelById.size);

	constructor(private readonly deps: PanelBrowserStateDeps) {}

	get browserPanels(): BrowserPanel[] {
		return this.deps
			.getWorkspacePanels()
			.filter((panel): panel is BrowserWorkspacePanel => panel.kind === "browser");
	}

	set browserPanels(nextPanels: BrowserPanel[]) {
		this.syncBrowserPanelIndexes(nextPanels);
		this.replaceWorkspacePanels("browser", nextPanels);
	}

	private replaceWorkspacePanels(
		kind: WorkspacePanelKind,
		nextPanels: readonly WorkspacePanel[]
	): void {
		const remainingPanels = this.deps.getWorkspacePanels().filter((panel) => panel.kind !== kind);
		this.deps.setWorkspacePanels(Array.from(nextPanels).concat(remainingPanels));
	}

	syncBrowserPanelIndexes(nextPanels: readonly BrowserPanel[]): void {
		this.browserPanelById.clear();
		const groupedPanels = new Map<string, BrowserPanel[]>();
		for (const panel of nextPanels) {
			this.browserPanelById.set(panel.id, panel);
			const existing = groupedPanels.get(panel.projectPath);
			if (existing) {
				existing.push(panel);
			} else {
				groupedPanels.set(panel.projectPath, [panel]);
			}
		}
		for (const projectPath of this.browserPanelsByProject.keys()) {
			if (!groupedPanels.has(projectPath)) {
				this.browserPanelsByProject.delete(projectPath);
			}
		}
		for (const [projectPath, panels] of groupedPanels.entries()) {
			const current = this.browserPanelsByProject.get(projectPath);
			if (!areBrowserPanelListsEqual(current, panels)) {
				this.browserPanelsByProject.set(projectPath, panels);
			}
		}
	}

	hasBrowserPanel(panelId: string): boolean {
		return this.browserPanelById.has(panelId);
	}

	getBrowserPanelProjectPath(panelId: string): string | null {
		return this.browserPanelById.get(panelId)?.projectPath ?? null;
	}

	clearAllBrowserPanels(): void {
		for (const panel of this.browserPanels) {
			browserWebview.close(`browser-${panel.id}`);
		}
		this.browserPanels = [];
	}

	openBrowserPanel(projectPath: string, url: string, title?: string): BrowserPanel {
		if (!projectPath) {
			logger.warn("openBrowserPanel called without projectPath", { url });
		}
		const existing = this.getBrowserPanelsForProject(projectPath).find(
			(panel) => panel.url === url
		);
		if (existing) {
			this.deps.focusOpenedTopLevelPanel(existing.id);
			logger.debug("Browser panel already open for URL, focusing", { url, projectPath });
			return existing;
		}

		const panel: BrowserPanel = {
			id: crypto.randomUUID(),
			kind: "browser",
			projectPath,
			url,
			title: title ?? url,
			width: DEFAULT_BROWSER_PANEL_WIDTH,
			ownerPanelId: null,
		};

		this.browserPanels = [panel, ...this.browserPanels];
		this.deps.focusOpenedTopLevelPanel(panel.id);
		this.deps.onPersist();

		logger.debug("Opened browser panel", { url, panelId: panel.id });
		return panel;
	}

	closeBrowserPanel(panelId: string): void {
		const closeState = this.deps.captureTopLevelPanelCloseState(panelId);
		browserWebview.close(`browser-${panelId}`);
		this.browserPanels = this.browserPanels.filter((panel) => panel.id !== panelId);
		this.deps.applyTopLevelPanelCloseState(closeState);
		this.deps.onPersist();
		logger.debug("Closed browser panel", { panelId });
	}

	resizeBrowserPanel(panelId: string, delta: number): void {
		this.browserPanels = this.browserPanels.map((panel) =>
			panel.id === panelId
				? { ...panel, width: Math.max(panel.width + delta, MIN_BROWSER_PANEL_WIDTH) }
				: panel
		);
		this.deps.onPersist();
	}

	getBrowserPanel(panelId: string): BrowserPanel | undefined {
		return this.browserPanelById.get(panelId);
	}

	getBrowserPanelsForProject(projectPath: string): BrowserPanel[] {
		return this.browserPanelsByProject.get(projectPath) ?? [];
	}
}
