import * as Schema from "effect/Schema"

// The ACP ToolKind enum in full, in its own order: Cursor sends this field
// verbatim, so a literal missing here decodes to "other" and loses the kind.
export const CURSOR_ACP_TOOL_KINDS = [
	"read",
	"edit",
	"delete",
	"move",
	"search",
	"execute",
	"think",
	"fetch",
	"switch_mode",
	"other"
] as const
export const CursorAcpToolKind = Schema.Literals(CURSOR_ACP_TOOL_KINDS)
export type CursorAcpToolKind = typeof CursorAcpToolKind.Type

export const CursorToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type CursorToolStatus = typeof CursorToolStatus.Type

export const TextDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("text_delta"),
	token: Schema.String.check(Schema.isNonEmpty())
})
export type TextDeltaFact = typeof TextDeltaFact.Type

export const ThoughtDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("thought_delta"),
	token: Schema.String.check(Schema.isNonEmpty())
})
export type ThoughtDeltaFact = typeof ThoughtDeltaFact.Type

export const ToolCallFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	title: Schema.String.check(Schema.isNonEmpty()),
	kind: CursorAcpToolKind,
	status: CursorToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: Schema.optionalKey(CursorToolStatus),
	// #273: the tool's own result, read off the ACP update's content blocks
	// (else its rawOutput). Without it a settled tool call reaches
	// projection_session_activities with a status and no result to show.
	output: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type ToolCallUpdateFact = typeof ToolCallUpdateFact.Type

export const PermissionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("permission_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	permission: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.String.check(Schema.isNonEmpty())
})
export type PermissionRequestFact = typeof PermissionRequestFact.Type

export const PlanProposalFact = Schema.Struct({
	contractKind: Schema.Literal("plan_proposal"),
	planMarkdown: Schema.String.check(Schema.isNonEmpty())
})
export type PlanProposalFact = typeof PlanProposalFact.Type

export const ProviderSessionFact = Schema.Struct({
	contractKind: Schema.Literal("provider_session"),
	providerSessionId: Schema.String.check(Schema.isNonEmpty())
})
export type ProviderSessionFact = typeof ProviderSessionFact.Type

export const TurnCompleteFact = Schema.Struct({
	contractKind: Schema.Literal("turn_complete")
})
export type TurnCompleteFact = typeof TurnCompleteFact.Type

export const TurnErrorFact = Schema.Struct({
	contractKind: Schema.Literal("turn_error"),
	detail: Schema.String.check(Schema.isNonEmpty())
})
export type TurnErrorFact = typeof TurnErrorFact.Type

export const CursorContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	PlanProposalFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type CursorContractFact = typeof CursorContractFact.Type

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
})

export const turnCompleteFact: TurnCompleteFact = {
	contractKind: "turn_complete"
}
