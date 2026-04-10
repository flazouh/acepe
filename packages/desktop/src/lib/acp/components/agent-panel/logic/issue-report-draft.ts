export interface AgentErrorIssueDraftInput {
	agentId: string;
	sessionId: string | null;
	projectPath: string | null;
	worktreePath: string | null;
	errorSummary: string;
	errorDetails: string;
	// Optional enriched context
	sessionTitle?: string | null;
	sessionCreatedAt?: Date | null;
	sessionUpdatedAt?: Date | null;
	currentModelId?: string | null;
	entryCount?: number | null;
	panelConnectionState?: string | null;
}

export interface AgentErrorIssueDraft {
	title: string;
	body: string;
	category: "bug";
}

export function buildAgentErrorIssueDraft(input: AgentErrorIssueDraftInput): AgentErrorIssueDraft {
	const title = `[${input.agentId}] ${input.errorSummary}`;

	const contextLines: string[] = [
		`| Field | Value |`,
		`| --- | --- |`,
		`| Agent | \`${input.agentId}\` |`,
		`| Session ID | \`${input.sessionId ?? "unknown"}\` |`,
		`| Project Path | \`${input.projectPath ?? "unknown"}\` |`,
		`| Worktree Path | \`${input.worktreePath ?? "none"}\` |`,
	];

	if (input.sessionTitle) {
		contextLines.push(`| Session Title | ${input.sessionTitle} |`);
	}
	if (input.currentModelId) {
		contextLines.push(`| Model | \`${input.currentModelId}\` |`);
	}
	if (input.entryCount != null) {
		contextLines.push(`| Message Count | ${input.entryCount} |`);
	}
	if (input.panelConnectionState) {
		contextLines.push(`| Connection State | \`${input.panelConnectionState}\` |`);
	}
	if (input.sessionCreatedAt) {
		contextLines.push(`| Session Created | ${input.sessionCreatedAt.toISOString()} |`);
	}
	if (input.sessionUpdatedAt) {
		contextLines.push(`| Session Updated | ${input.sessionUpdatedAt.toISOString()} |`);
	}

	const body = [
		"## Summary",
		input.errorSummary,
		"",
		"## Context",
		...contextLines,
		"",
		"## Error Details",
		"```text",
		input.errorDetails,
		"```",
	].join("\n");

	return { title, body, category: "bug" };
}
