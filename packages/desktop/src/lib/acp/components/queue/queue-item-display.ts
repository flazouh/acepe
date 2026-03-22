import { getToolKindSubtitle, getToolKindTitle } from "../../registry/tool-kind-ui-registry.js";
import type { ToolCall } from "../../types/tool-call.js";

function getChildSummary(child: ToolCall): string | null {
	if (child.arguments.kind === "think" && child.arguments.description) {
		const trimmedDescription = child.arguments.description.trim();
		if (trimmedDescription.length > 0) {
			return trimmedDescription;
		}
	}

	const childKind = child.kind ?? "other";
	const subtitle = getToolKindSubtitle(childKind, child)?.trim();
	if (subtitle && subtitle.length > 0) {
		return subtitle;
	}

	const title = getToolKindTitle(childKind, child).trim();
	return title.length > 0 ? title : null;
}

/**
 * Extract ordered sub-agent summaries from a Task tool call.
 * Returns one display string per child tool call.
 */
export function getTaskSubagentSummaries(toolCall: ToolCall): string[] {
	const children = toolCall.taskChildren ?? [];
	if (children.length === 0) {
		return [];
	}

	return children.map(getChildSummary).filter((summary): summary is string => summary !== null);
}
