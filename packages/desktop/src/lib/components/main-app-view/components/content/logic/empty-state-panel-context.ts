interface EmptyStatePanel {
	readonly id: string;
}

interface EmptyStatePanelStore {
	readonly panels: ReadonlyArray<EmptyStatePanel>;
	spawnPanel(options: {
		requireProjectSelection?: boolean;
		projectPath?: string;
		id?: string;
		selectedAgentId?: string | null;
	}): EmptyStatePanel;
	setPanelAgent(panelId: string, agentId: string | null): void;
	setPanelProjectPath(panelId: string, projectPath: string): void;
	updatePanelSession(panelId: string, sessionId: string | null): void;
}

export function ensureEmptyStatePanelContext(options: {
	panelStore: EmptyStatePanelStore;
	panelId: string;
	projectPath: string;
	selectedAgentId: string;
}): void {
	const existingPanel = options.panelStore.panels.find((panel) => panel.id === options.panelId);

	if (!existingPanel) {
		options.panelStore.spawnPanel({
			requireProjectSelection: false,
			projectPath: options.projectPath,
			id: options.panelId,
			selectedAgentId: options.selectedAgentId,
		});
		return;
	}

	options.panelStore.setPanelProjectPath(options.panelId, options.projectPath);
	options.panelStore.setPanelAgent(options.panelId, options.selectedAgentId);
}

export function attachSessionToEmptyStatePanel(options: {
	panelStore: EmptyStatePanelStore;
	panelId: string;
	sessionId: string;
}): boolean {
	const existingPanel = options.panelStore.panels.find((panel) => panel.id === options.panelId);
	if (!existingPanel) {
		return false;
	}

	options.panelStore.updatePanelSession(options.panelId, options.sessionId);
	return true;
}
