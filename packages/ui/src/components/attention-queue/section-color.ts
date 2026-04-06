import { Colors } from "../../lib/colors.js";
import type { SectionedFeedSectionId } from "./types.js";

export function sectionColor(id: SectionedFeedSectionId): string {
	switch (id) {
		case "answer_needed":
			return Colors.orange;
		case "planning":
			return "var(--plan-icon)";
		case "working":
			return "var(--build-icon)";
		case "finished":
			return "var(--success-reference)";
		case "error":
			return Colors.red;
	}
}