export const OTHER_TOOL_PREVIEW_LIMIT = 140;

export function hasOtherToolDetails(detailsText?: string | null): boolean {
	return Boolean(detailsText && detailsText.trim().length > 0);
}

export function getOtherToolDetailsPreview(
	detailsText?: string | null
): string | null {
	if (!detailsText) return null;
	const compact = detailsText.replace(/\s+/g, " ").trim();
	if (!compact) return null;
	return compact.length > OTHER_TOOL_PREVIEW_LIMIT
		? `${compact.slice(0, OTHER_TOOL_PREVIEW_LIMIT)}...`
		: compact;
}
