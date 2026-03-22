import { UI } from "$lib/acp/constants/ui.js";

export const STRUCTURED_VIEW_ROW_ESTIMATE_PX = 38;
export const STRUCTURED_VIEW_OVERSCAN = 8;

export function shouldVirtualizeStructuredEntries(entryCount: number): boolean {
	return entryCount >= UI.VIRTUALIZATION_THRESHOLD;
}
