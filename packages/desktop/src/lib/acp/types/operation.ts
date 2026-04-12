import type { ToolArguments } from "../../services/converted-session-types.js";
import type { ToolCall } from "./tool-call.js";

export type OperationKind = ToolCall["kind"];
export type OperationStatus = ToolCall["status"];

export type OperationIdentityAliasKind = "tool-call-id" | "entry-id" | "execute-command";
export type OperationIdentityProofKind =
	| "transport-tool-call-id"
	| "transcript-entry-id"
	| "canonical-execute-command";

export interface OperationIdentityAlias {
	readonly kind: OperationIdentityAliasKind;
	readonly proof: OperationIdentityProofKind;
	readonly value: string;
}

export interface OperationIdentity {
	readonly primary: OperationIdentityAlias;
	readonly aliases: ReadonlyArray<OperationIdentityAlias>;
}

export interface OperationIdentityProof {
	readonly kind: OperationIdentityAliasKind;
	readonly proof: OperationIdentityProofKind;
	readonly value: string;
}

export interface Operation {
	readonly id: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly sourceEntryId: string | null;
	readonly identity: OperationIdentity;
	readonly name: string;
	readonly rawInput: ToolCall["rawInput"];
	readonly kind: OperationKind;
	readonly status: OperationStatus;
	readonly title: string | null | undefined;
	readonly arguments: ToolArguments;
	readonly progressiveArguments?: ToolArguments;
	readonly result: ToolCall["result"];
	readonly locations: ToolCall["locations"];
	readonly skillMeta: ToolCall["skillMeta"];
	readonly normalizedQuestions: ToolCall["normalizedQuestions"];
	readonly normalizedTodos: ToolCall["normalizedTodos"];
	readonly questionAnswer: ToolCall["questionAnswer"];
	readonly awaitingPlanApproval: boolean;
	readonly planApprovalRequestId: ToolCall["planApprovalRequestId"];
	readonly startedAtMs?: number;
	readonly completedAtMs?: number;
	readonly command: string | null;
	readonly parentToolCallId: string | null;
	readonly parentOperationId: string | null;
	readonly childToolCallIds: ReadonlyArray<string>;
	readonly childOperationIds: ReadonlyArray<string>;
}
