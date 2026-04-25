import type {
	JsonValue,
	QuestionAnswer,
	QuestionItem,
	SkillMeta,
	TodoItem,
	ToolArguments,
	ToolCallLocation,
	ToolCallStatus,
	ToolKind,
} from "../../services/converted-session-types.js";
import type { OperationDegradationReason } from "../../services/acp-types.js";

export type OperationKind = ToolKind | null | undefined;
export type OperationStatus = ToolCallStatus;

export type OperationState =
	| "pending"
	| "running"
	| "blocked"
	| "completed"
	| "failed"
	| "cancelled"
	| "degraded";

export interface Operation {
	readonly id: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly sourceEntryId: string | null;
	readonly name: string;
	readonly kind: OperationKind;
	readonly status: OperationStatus;
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
