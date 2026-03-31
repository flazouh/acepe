import { Colors } from "../../lib/colors.js";
import type { SectionedFeedSectionId } from "./types.js";

export function sectionColor(id: SectionedFeedSectionId): string {
	switch (id) {
		case "answer_needed":
			return Colors.orange;
		case "working":
		case "planning":
			return Colors.purple;
		case "finished":
			return Colors.green;
		case "error":
			return Colors.red;
	}
}