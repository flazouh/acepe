export interface AgentPanelProjectSelectionVisibilityInput {
	readonly sessionId: string | null;
	readonly projectCount: number | null;
	readonly pendingProjectSelection: boolean;
	readonly projectKnown: boolean;
}

export function shouldShowAgentPanelProjectSelection(
	input: AgentPanelProjectSelectionVisibilityInput
): boolean {
	if (input.sessionId !== null) {
		return false;
	}

	return (
		input.projectCount !== null &&
		input.projectCount > 1 &&
		(input.pendingProjectSelection || !input.projectKnown)
	);
}
