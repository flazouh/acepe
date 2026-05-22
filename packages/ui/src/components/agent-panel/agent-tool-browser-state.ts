export const SCRIPT_COLLAPSE_CHARACTER_LIMIT = 280;
export const SCRIPT_COLLAPSE_LINE_LIMIT = 6;
export const SCRIPT_PREVIEW_LINE_LIMIT = 3;
export const DETAILS_PREVIEW_CHARACTER_LIMIT = 140;

export function countBrowserToolLines(text: string): number {
	return text.split("\n").length;
}

export function normalizeBrowserToolScript(scriptText: string | null | undefined): string {
	return scriptText?.trim() ?? "";
}

export function hasBrowserToolDetails(detailsText: string | null | undefined): boolean {
	return Boolean(detailsText && detailsText.trim().length > 0);
}

export function isBrowserToolScriptCollapsible(input: {
	readonly scriptText: string;
	readonly characterLimit?: number;
	readonly lineLimit?: number;
}): boolean {
	const characterLimit = input.characterLimit ?? SCRIPT_COLLAPSE_CHARACTER_LIMIT;
	const lineLimit = input.lineLimit ?? SCRIPT_COLLAPSE_LINE_LIMIT;
	return (
		input.scriptText.length > characterLimit || countBrowserToolLines(input.scriptText) > lineLimit
	);
}

export function buildBrowserToolScriptPreview(input: {
	readonly scriptText: string;
	readonly lineLimit?: number;
}): string {
	const trimmed = input.scriptText.trim();
	if (!trimmed) return "";

	const lineLimit = input.lineLimit ?? SCRIPT_PREVIEW_LINE_LIMIT;
	const lines = trimmed.split("\n");
	const limitedLines = lines.slice(0, lineLimit);
	const preview = limitedLines.join("\n");
	if (lines.length > lineLimit || trimmed.length > preview.length) {
		return `${preview}\n...`;
	}
	return preview;
}

export function buildBrowserToolDetailsPreview(input: {
	readonly detailsText: string | null | undefined;
	readonly characterLimit?: number;
}): string | null {
	if (!input.detailsText) return null;

	const compact = input.detailsText.replace(/\s+/g, " ").trim();
	if (!compact) return null;

	const characterLimit = input.characterLimit ?? DETAILS_PREVIEW_CHARACTER_LIMIT;
	if (compact.length <= characterLimit) {
		return compact;
	}

	return `${compact.slice(0, characterLimit)}...`;
}
