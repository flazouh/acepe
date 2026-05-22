import type { AgentToolStatus } from "./types.js";

const FETCH_PREVIEW_LIMIT = 120;

export function isFetchPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function isFetchError(status: AgentToolStatus): boolean {
	return status === "error";
}

export function getFetchTitle(
	status: AgentToolStatus,
	labels: {
		fetchingLabel: string;
		fetchFailedLabel: string;
		fetchedLabel: string;
	}
): string {
	if (isFetchPending(status)) return labels.fetchingLabel;
	if (isFetchError(status)) return labels.fetchFailedLabel;
	return labels.fetchedLabel;
}

export function getFetchTargetText(input: {
	domain?: string | null;
	url?: string | null;
}): string | null {
	return input.domain ?? input.url ?? null;
}

export function hasFetchResult(resultText?: string | null): boolean {
	return Boolean(resultText && resultText.trim().length > 0);
}

export function getFetchResultPreview(resultText?: string | null): string | null {
	if (!resultText) return null;
	const compact = resultText.replace(/\s+/g, " ").trim();
	if (!compact) return null;
	return compact.length > FETCH_PREVIEW_LIMIT
		? `${compact.slice(0, FETCH_PREVIEW_LIMIT)}...`
		: compact;
}

export function getFetchResultLabel(
	status: AgentToolStatus,
	labels: {
		resultLabel: string;
		errorLabel: string;
	}
): string {
	return isFetchError(status) ? labels.errorLabel : labels.resultLabel;
}
