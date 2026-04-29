import type {
	OperationDegradationReason,
	OperationSourceLink,
} from "../../services/acp-types.js";
import type {
	JsonValue,
	QuestionAnswer,
	QuestionItem,
	SkillMeta,
	TodoItem,
	ToolArguments,
	ToolCallLocation,
} from "../../services/converted-session-types.js";

/** Provider-layer provenance status carried by the Operation for observability. Not used for product decisions — use operationState for all canonical state logic. */
export type OperationProviderStatus = "pending" | "in_progress" | "completed" | "failed";

/** Provider-layer tool classification carried by the Operation as provenance evidence. Not used for canonical state decisions. */
export type OperationKind =
	| "read"
	| "read_lints"
	| "edit"
	| "execute"
	| "search"
	| "glob"
	| "fetch"
	| "web_search"
	| "think"
	| "todo"
	| "question"
	| "task"
	| "task_output"
	| "skill"
	| "move"
	| "delete"
	| "enter_plan_mode"
	| "exit_plan_mode"
	| "create_plan"
	| "tool_search"
	| "browser"
	| "sql"
	| "unclassified"
	| "other"
	| null
	| undefined;

export type OperationState = import("../../services/acp-types.js").OperationState;

export interface Operation {
	readonly id: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly sourceLink: OperationSourceLink;
	readonly name: string;
	readonly kind: OperationKind;
	/** Provider-layer provenance status. Use operationState for all canonical state decisions. */
	readonly status: OperationProviderStatus;
	readonly operationState: OperationState;
	readonly operationProvenanceKey?: string | null;
	readonly title: string | null | undefined;
	readonly arguments: ToolArguments;
	readonly progressiveArguments?: ToolArguments;
	readonly result: JsonValue | null | undefined;
	readonly locations: ToolCallLocation[] | null | undefined;
	readonly skillMeta: SkillMeta | null | undefined;
	readonly normalizedQuestions: QuestionItem[] | null | undefined;
	readonly normalizedTodos: TodoItem[] | null | undefined;
	readonly questionAnswer: QuestionAnswer | null | undefined;
	readonly awaitingPlanApproval: boolean;
	readonly planApprovalRequestId: number | null | undefined;
	readonly startedAtMs?: number;
	readonly completedAtMs?: number;
	readonly command: string | null;
	readonly parentToolCallId: string | null;
	readonly parentOperationId: string | null;
	readonly childToolCallIds: ReadonlyArray<string>;
	readonly childOperationIds: ReadonlyArray<string>;
	readonly degradationReason?: OperationDegradationReason | null;
}
