export interface PlanningPlaceholderPresentation {
	readonly label: string;
	readonly agentIconSrc: string | null;
	readonly showWorkingSpark: boolean;
}

export function resolvePlanningPlaceholderPresentation(input: {
	readonly agentName: string | null | undefined;
	readonly agentIconSrc: string | null | undefined;
	readonly showWorkingSpark: boolean;
}): PlanningPlaceholderPresentation {
	const agentName = normalizeAgentName(input.agentName);

	return {
		label: `Connecting to ${agentName}`,
		agentIconSrc: input.agentIconSrc ?? null,
		showWorkingSpark: input.showWorkingSpark,
	};
}

function normalizeAgentName(agentName: string | null | undefined): string {
	const trimmed = agentName?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : "agent";
}
