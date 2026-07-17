import type { SectionedFeedSectionId } from "./types.js";

/**
 * Status colors for attention / kanban section accents.
 *
 * Uses the Cursor theme status palette from
 * `packages/desktop/static/themes/cursor*.theme.json` via CSS vars
 * (`--cursor-status-*`), not the bright TAG_COLORS rainbow.
 */
export function sectionColor(id: SectionedFeedSectionId): string {
	switch (id) {
		case "answer_needed":
			return "var(--cursor-status-warning)";
		case "planning":
			return "var(--muted-foreground)";
		case "working":
			return "var(--muted-foreground)";
		case "needs_review":
			return "var(--cursor-status-success)";
		case "idle":
			return "var(--muted-foreground)";
		case "error":
			return "var(--cursor-status-error)";
	}
}

export function sectionAccentColor(id: SectionedFeedSectionId): string {
	return sectionColor(id);
}
