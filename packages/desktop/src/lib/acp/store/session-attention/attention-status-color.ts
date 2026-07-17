import type { AttentionKind } from "./attention-kind.js";

/**
 * Cursor theme status colors for attention icons.
 * Values are CSS vars mapped from `packages/desktop/static/themes/cursor*.theme.json`.
 */
export function attentionStatusColor(kind: AttentionKind): string {
	if (kind === "answer_needed") {
		return "var(--cursor-status-warning)";
	}
	if (kind === "error") {
		return "var(--cursor-status-error)";
	}
	return "var(--cursor-status-success)";
}
