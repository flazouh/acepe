import { openUrl } from "@tauri-apps/plugin-opener";

export interface IssueReportMetadataEntry {
	readonly label: string;
	readonly value: string;
}

export interface IssueReportDraft {
	readonly title: string;
	readonly body: string;
	readonly category: string;
	readonly referenceId: string | null;
	readonly referenceSearchable: boolean;
	readonly issueNumber: number | null;
	readonly issueUrl: string | null;
	readonly surface: string | null;
	readonly diagnosticsSummary: string | null;
}

interface BuildIssueReportDraftInput {
	readonly title: string;
	readonly summary: string;
	readonly details: string;
	readonly category?: string;
	readonly referenceId?: string | null;
	readonly referenceSearchable?: boolean;
	readonly issueNumber?: number | null;
	readonly issueUrl?: string | null;
	readonly surface?: string | null;
	readonly diagnosticsSummary?: string | null;
	readonly metadata?: ReadonlyArray<IssueReportMetadataEntry>;
}

const DEFAULT_ISSUE_REPO_URL = "https://github.com/flazouh/acepe/issues/new";

function pushContextLine(lines: string[], label: string, value: string | null): void {
	if (value === null) {
		return;
	}

	lines.push(`| ${label} | ${value} |`);
}

function formatSearchability(referenceSearchable: boolean): string {
	return referenceSearchable ? "searchable in Sentry" : "local only";
}

export function buildIssueReportDraft(input: BuildIssueReportDraftInput): IssueReportDraft {
	const metadata = input.metadata ?? [];
	const contextLines: string[] = ["| Field | Value |", "| --- | --- |"];

	pushContextLine(contextLines, "Surface", input.surface ?? null);
	pushContextLine(contextLines, "Reference ID", input.referenceId ?? null);
	pushContextLine(
		contextLines,
		"Reference visibility",
		input.referenceId ? formatSearchability(input.referenceSearchable === true) : null
	);
	pushContextLine(
		contextLines,
		"Existing issue",
		input.issueUrl ??
			(input.issueNumber !== null && input.issueNumber !== undefined
				? `#${input.issueNumber}`
				: null)
	);
	pushContextLine(contextLines, "Diagnostics summary", input.diagnosticsSummary ?? null);

	for (const entry of metadata) {
		pushContextLine(contextLines, entry.label, entry.value);
	}

	const body = [
		"## Summary",
		input.summary,
		"",
		"## Context",
		...contextLines,
		"",
		"## Error Details",
		"```text",
		input.details,
		"```",
	].join("\n");

	return {
		title: input.title,
		body,
		category: input.category ?? "bug",
		referenceId: input.referenceId ?? null,
		referenceSearchable: input.referenceSearchable === true,
		issueNumber: input.issueNumber ?? null,
		issueUrl: input.issueUrl ?? null,
		surface: input.surface ?? null,
		diagnosticsSummary: input.diagnosticsSummary ?? null,
	};
}

export function resolveIssueActionLabel(draft: IssueReportDraft): string {
	if (draft.issueNumber !== null) {
		return `Open issue #${draft.issueNumber}`;
	}

	if (draft.issueUrl !== null) {
		return "Open issue";
	}

	return "Create issue";
}

export function openIssueReportDraft(draft: IssueReportDraft): void {
	if (draft.issueUrl !== null) {
		void openUrl(draft.issueUrl).catch(() => {});
		return;
	}

	const params = new URLSearchParams();
	if (draft.title.length > 0) {
		params.set("title", draft.title);
	}
	if (draft.body.length > 0) {
		params.set("body", draft.body);
	}
	if (draft.category.length > 0) {
		params.set("labels", draft.category);
	}
	void openUrl(`${DEFAULT_ISSUE_REPO_URL}?${params.toString()}`).catch(() => {});
}
