import {
	buildIssueReportDraft,
	type IssueReportDraft,
	type IssueReportMetadataEntry,
} from "../../../../errors/issue-report.js";

export interface AgentErrorIssueDraftInput {
	agentId: string;
	sessionId: string | null;
	projectPath: string | null;
	worktreePath: string | null;
	errorSummary: string;
	errorDetails: string;
	referenceId?: string | null;
	referenceSearchable?: boolean;
	issueNumber?: number | null;
	issueUrl?: string | null;
	diagnosticsSummary?: string | null;
	sessionTitle?: string | null;
	sessionCreatedAt?: Date | null;
	sessionUpdatedAt?: Date | null;
	currentModelId?: string | null;
	entryCount?: number | null;
	panelConnectionState?: string | null;
}

function pushMetadataEntry(
	entries: IssueReportMetadataEntry[],
	label: string,
	value: string | number | null | undefined
): void {
	if (value === null || value === undefined) {
		return;
	}

	entries.push({
		label,
		value: String(value),
	});
}

export function buildAgentErrorIssueDraft(input: AgentErrorIssueDraftInput): IssueReportDraft {
	const metadata: IssueReportMetadataEntry[] = [];
	pushMetadataEntry(metadata, "Agent", input.agentId);
	pushMetadataEntry(metadata, "Session ID", input.sessionId ?? "unknown");
	pushMetadataEntry(metadata, "Project Path", input.projectPath ?? "unknown");
	pushMetadataEntry(metadata, "Worktree Path", input.worktreePath ?? "none");
	pushMetadataEntry(metadata, "Session Title", input.sessionTitle);
	pushMetadataEntry(metadata, "Model", input.currentModelId);
	pushMetadataEntry(metadata, "Message Count", input.entryCount);
	pushMetadataEntry(metadata, "Connection State", input.panelConnectionState);
	pushMetadataEntry(metadata, "Session Created", input.sessionCreatedAt?.toISOString() ?? null);
	pushMetadataEntry(metadata, "Session Updated", input.sessionUpdatedAt?.toISOString() ?? null);

	return buildIssueReportDraft({
		title: `[${input.agentId}] ${input.errorSummary}`,
		summary: input.errorSummary,
		details: input.errorDetails,
		referenceId: input.referenceId ?? null,
		referenceSearchable: input.referenceSearchable === true,
		issueNumber: input.issueNumber ?? null,
		issueUrl: input.issueUrl ?? null,
		surface: "agent-panel",
		diagnosticsSummary: input.diagnosticsSummary ?? null,
		metadata,
	});
}
