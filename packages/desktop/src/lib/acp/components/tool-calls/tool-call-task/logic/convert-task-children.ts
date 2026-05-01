import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";
import type { TurnState } from "../../../../store/types.js";
import type { ToolCall } from "../../../../types/tool-call.js";
import { mapToolCallToSceneEntry } from "../../../agent-panel/scene/desktop-agent-panel-scene.js";

/**
 * Convert taskChildren (ToolCall[]) into AgentPanelSceneEntryModel[] for the AgentToolTask UI.
 */
export function convertTaskChildren(
	children: ToolCall[] | null | undefined,
	turnState?: TurnState,
	parentCompleted: boolean = false
): AgentPanelSceneEntryModel[] {
	if (!children || children.length === 0) return [];
	return children.map((child) => mapToolCallToSceneEntry(child, turnState, parentCompleted, child.id));
}
