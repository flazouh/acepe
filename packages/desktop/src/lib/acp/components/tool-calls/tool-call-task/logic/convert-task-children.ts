import type { AgentToolEntry } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../../store/types.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import { mapToolCallToSceneEntry } from "../../../agent-panel/scene/tool/tool-call-entry.js";

export function convertTaskChildren(
	children: readonly ToolCall[] | null | undefined,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AgentToolEntry[] {
	if (!children || children.length === 0) {
		return [];
	}

	const entries: AgentToolEntry[] = [];
	for (const child of children) {
		const entry = mapToolCallToSceneEntry(child, turnState, parentCompleted);
		if (entry.type === "tool_call") {
			entries.push(entry);
		}
	}
	return entries;
}
