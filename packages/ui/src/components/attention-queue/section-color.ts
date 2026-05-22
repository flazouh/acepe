import { Colors } from "../../lib/colors.js";
import type { SectionedFeedSectionId } from "./types.js";

export function sectionColor(id: SectionedFeedSectionId): string {
	switch (id) {
		case "answer_needed":
			return Colors.orange;
		case "planning":
			return Colors.purple;
		case "working":
			return Colors.blue;
		case "needs_review":
			return Colors.pink;
		case "idle":
			return "var(--success-reference)";
		case "error":
			return Colors.red;
	}
}

export function sectionAccentColor(id: SectionedFeedSectionId): string {
	if (id === "needs_review") {
		return Colors.purple;
	}

	return sectionColor(id);
}
