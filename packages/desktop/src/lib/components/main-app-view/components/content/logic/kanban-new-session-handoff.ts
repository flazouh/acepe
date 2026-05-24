export interface KanbanNewSessionPanelStore {
	updatePanelSession(panelId: string, sessionId: string | null): void;
	movePanelToFront(panelId: string): void;
	focusPanel(panelId: string): void;
	openSession(sessionId: string, width: number): object | null;
}

export interface CompleteKanbanNewSessionHandoffInput {
	readonly panelStore: KanbanNewSessionPanelStore;
	readonly panelId: string | null | undefined;
	readonly sessionId: string;
	readonly sessionPanelWidth: number;
}

export function completeKanbanNewSessionHandoff(
	input: CompleteKanbanNewSessionHandoffInput
): void {
	if (input.panelId) {
		input.panelStore.updatePanelSession(input.panelId, input.sessionId);
		input.panelStore.movePanelToFront(input.panelId);
		input.panelStore.focusPanel(input.panelId);
		return;
	}

	input.panelStore.openSession(input.sessionId, input.sessionPanelWidth);
}
