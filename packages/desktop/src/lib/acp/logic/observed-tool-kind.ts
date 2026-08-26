import type { ToolKind } from "../../services/acp-types.js";

// The canonical ToolCallObserved contract event and RpcProjectedSessionActivity
// carry the provider's classification as a plain string (see
// ToolCallObservedPayload.kind in @acepe/contracts). OperationSnapshot.kind is
// the constrained ToolKind union, so this validates the string against that
// union before it becomes an operation's kind. An unrecognized or absent
// classification becomes null, which the display projection already treats as
// "not classified" -- never a guessed kind.
const OPERATION_TOOL_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>([
	"read",
	"read_lints",
	"edit",
	"execute",
	"shell_input",
	"search",
	"glob",
	"fetch",
	"web_search",
	"think",
	"todo",
	"question",
	"task",
	"task_output",
	"skill",
	"move",
	"delete",
	"enter_plan_mode",
	"exit_plan_mode",
	"create_plan",
	"tool_search",
	"browser",
	"computer",
	"sql",
	"unclassified",
	"other",
]);

export function asOperationToolKind(kind: string | null | undefined): ToolKind | null {
	if (kind === null || kind === undefined) {
		return null;
	}
	return OPERATION_TOOL_KINDS.has(kind as ToolKind) ? (kind as ToolKind) : null;
}
