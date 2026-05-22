import type { FilePanel } from "$lib/acp/store/file-panel-type.js";
import type { BrowserPanel } from "$lib/acp/store/browser-panel-type.js";
import type { ReviewPanel } from "$lib/acp/store/review-panel-type.js";
import type { TerminalPanelGroup, WorkspacePanel } from "$lib/acp/store/types.js";

export type PanelsContainerFullscreenTarget =
	| {
			readonly kind: "agent";
			readonly panelId: string;
	  }
	| {
			readonly kind: "file";
			readonly panel: FilePanel;
	  }
	| {
			readonly kind: "review";
			readonly panel: ReviewPanel;
	  }
	| {
			readonly kind: "terminal";
			readonly panel: TerminalPanelGroup;
	  }
	| {
			readonly kind: "browser";
			readonly panel: BrowserPanel;
	  };

export function resolvePanelsContainerFullscreenTarget(input: {
	readonly fullscreenPanelId: string | null;
	readonly topLevelPanel: WorkspacePanel | undefined;
	readonly filePanels: readonly FilePanel[];
	readonly reviewPanels: readonly ReviewPanel[];
	readonly terminalPanels: readonly TerminalPanelGroup[];
	readonly browserPanels: readonly BrowserPanel[];
}): PanelsContainerFullscreenTarget | null {
	const panelId = input.fullscreenPanelId;
	if (panelId === null) {
		return null;
	}

	if (input.topLevelPanel?.kind === "agent") {
		return { kind: "agent", panelId: input.topLevelPanel.id };
	}

	const filePanel = input.filePanels.find(
		(panel) => panel.ownerPanelId === null && panel.id === panelId
	);
	if (filePanel !== undefined) {
		return { kind: "file", panel: filePanel };
	}

	const reviewPanel = input.reviewPanels.find((panel) => panel.id === panelId);
	if (reviewPanel !== undefined) {
		return { kind: "review", panel: reviewPanel };
	}

	const terminalPanel = input.terminalPanels.find((panel) => panel.id === panelId);
	if (terminalPanel !== undefined) {
		return { kind: "terminal", panel: terminalPanel };
	}

	const browserPanel = input.browserPanels.find((panel) => panel.id === panelId);
	if (browserPanel !== undefined) {
		return { kind: "browser", panel: browserPanel };
	}

	return null;
}
