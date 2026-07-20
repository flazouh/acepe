import type { AnyAgentEntry } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../../store/types.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import { mapToolCallToSceneEntry } from "../../../agent-panel/scene/tool/tool-call-entry.js";

export function convertTaskChildren(
	children: readonly ToolCall[] | null | undefined,
	turnState: TurnState | undefined,
	parentCompleted: boolean
): AnyAgentEntry[] {
	if (!children || children.length === 0) {
		return [];
	}

	return children.map((child) => mapToolCallToSceneEntry(child, turnState, parentCompleted));
}
