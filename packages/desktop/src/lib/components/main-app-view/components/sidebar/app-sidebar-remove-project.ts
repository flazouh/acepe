import * as Effect from "effect/Effect";

/**
 * Removing a project is backend-owned: the sidebar dispatches `project.delete`
 * and the library projection stops listing the project, which is also what
 * drops its sessions from the list (`session-list.svelte` keeps only sessions
 * whose project is still projected).
 *
 * So this action never removes a session row itself. It only closes the panels
 * that were showing the project, because an open panel is transient UI state
 * and nothing in the projection describes it.
 */

export interface RemoveProjectPanel {
	readonly id: string;
}

export interface RemoveProjectPanels {
	closePanelBySessionId(sessionId: string): void;
	getTerminalPanelsForProject(projectPath: string): readonly RemoveProjectPanel[];
	getFilePanelsForProject(projectPath: string): readonly RemoveProjectPanel[];
	getBrowserPanelsForProject(projectPath: string): readonly RemoveProjectPanel[];
	closeTerminalPanel(panelId: string): void;
	closeFilePanel(panelId: string): void;
	closeBrowserPanel(panelId: string): void;
	removeWorkspacePanelsForProject(projectPath: string): void;
}

/**
 * The two producers of this failure disagree on the concrete class
 * (`ProjectError` through the project manager, `AppError` through the rpc
 * facade), and this action only ever reports the message.
 */
export interface RemoveProjectFailure {
	readonly message: string;
}

export interface RemoveProjectInput {
	readonly projectPath: string;
	/** Canonical session ids the projection currently lists for this project. */
	readonly openSessionIds: readonly string[];
	readonly panels: RemoveProjectPanels;
	readonly removeProject: (projectPath: string) => Effect.Effect<void, RemoveProjectFailure>;
	readonly onFailure: (error: RemoveProjectFailure) => void;
}

const closeProjectPanels = (
	panels: RemoveProjectPanels,
	projectPath: string,
	openSessionIds: readonly string[]
): void => {
	for (const sessionId of openSessionIds) {
		panels.closePanelBySessionId(sessionId);
	}
	for (const panel of panels.getTerminalPanelsForProject(projectPath)) {
		panels.closeTerminalPanel(panel.id);
	}
	for (const panel of panels.getFilePanelsForProject(projectPath)) {
		panels.closeFilePanel(panel.id);
	}
	for (const panel of panels.getBrowserPanelsForProject(projectPath)) {
		panels.closeBrowserPanel(panel.id);
	}
	panels.removeWorkspacePanelsForProject(projectPath);
};

export const removeProjectFromSidebar = (input: RemoveProjectInput): Effect.Effect<void> => {
	closeProjectPanels(input.panels, input.projectPath, input.openSessionIds);

	return input.removeProject(input.projectPath).pipe(
		Effect.catch((error) => {
			input.onFailure(error);
			return Effect.void;
		})
	);
};
