export interface ClaudeWorkingSparkVisibilityInput {
	readonly agentId: string;
	readonly projectedIsStreaming: boolean;
	readonly activityIsStreaming: boolean | null | undefined;
}

export function shouldShowClaudeWorkingSpark(
	input: ClaudeWorkingSparkVisibilityInput
): boolean {
	return (
		input.agentId === "claude-code" &&
		(input.projectedIsStreaming || input.activityIsStreaming === true)
	);
}
