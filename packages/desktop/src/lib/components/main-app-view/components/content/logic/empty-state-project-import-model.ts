import type { ErrorCauseDetails } from "$lib/acp/errors/error-cause-details.js";
import type { ErrorReferenceDetails } from "$lib/errors/error-reference.js";
import { buildIssueReportDraft, type IssueReportDraft } from "$lib/errors/issue-report.js";

export interface EmptyStateProjectImportErrorState {
	readonly title: string;
	readonly summary: string;
	readonly details: string;
	readonly referenceId: string;
	readonly referenceSearchable: boolean;
}

export interface BuildProjectImportErrorStateInput {
	readonly error: Error;
	readonly causeDetails: ErrorCauseDetails;
	readonly reference: ErrorReferenceDetails;
}

export function buildProjectImportErrorState(
	input: BuildProjectImportErrorStateInput
): EmptyStateProjectImportErrorState {
	return {
		title: "Project import failed",
		summary: input.causeDetails.rootCause ?? input.error.message,
		details: input.causeDetails.formatted,
		referenceId: input.reference.referenceId,
		referenceSearchable: input.reference.searchable,
	};
}

export interface BuildProjectImportIssueDraftInput {
	readonly errorState: EmptyStateProjectImportErrorState | null;
	readonly projectPath: string | null;
	readonly projectName: string | null;
}

export function buildProjectImportIssueDraft(
	input: BuildProjectImportIssueDraftInput
): IssueReportDraft | null {
	const errorState = input.errorState;
	if (errorState === null) {
		return null;
	}

	return buildIssueReportDraft({
		title: `Project import failed: ${errorState.summary}`,
		summary: errorState.summary,
		details: errorState.details,
		referenceId: errorState.referenceId,
		referenceSearchable: errorState.referenceSearchable,
		surface: "empty-state-project-import",
		diagnosticsSummary: errorState.summary,
		metadata: [
			{
				label: "Project Path",
				value: input.projectPath ?? "unknown",
			},
			{
				label: "Project Name",
				value: input.projectName ?? "unknown",
			},
		],
	});
}
