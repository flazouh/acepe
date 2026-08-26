import * as Schema from "effect/Schema"

export const CODEX_ACP_TOOL_KINDS = [
	"read",
	"edit",
	"execute",
	"search",
	"other"
] as const
export const CodexAcpToolKind = Schema.Literals(CODEX_ACP_TOOL_KINDS)
export type CodexAcpToolKind = typeof CodexAcpToolKind.Type

export const CodexToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type CodexToolStatus = typeof CodexToolStatus.Type

export const TextDeltaFact = Schema.Struct({
	contractKind: Schema.Literal("text_delta"),
	token: Schema.String.check(Schema.isNonEmpty()),
	aggregationHint: Schema.optionalKey(Schema.Literal("boundary_carryover"))
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
	kind: CodexAcpToolKind,
	status: CodexToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: CodexToolStatus,
	title: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	result: Schema.optionalKey(Schema.Json)
})
export type ToolCallUpdateFact = typeof ToolCallUpdateFact.Type

export const PermissionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("permission_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	permission: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	always: Schema.Array(Schema.String)
})
export type PermissionRequestFact = typeof PermissionRequestFact.Type

export const QuestionOption = Schema.Struct({
	label: Schema.String.check(Schema.isNonEmpty()),
	description: Schema.String.check(Schema.isNonEmpty())
})
export type QuestionOption = typeof QuestionOption.Type

export const QuestionItem = Schema.Struct({
	id: Schema.String.check(Schema.isNonEmpty()),
	header: Schema.String.check(Schema.isNonEmpty()),
	question: Schema.String.check(Schema.isNonEmpty()),
	multiSelect: Schema.Boolean,
	options: Schema.Array(QuestionOption)
})
export type QuestionItem = typeof QuestionItem.Type

export const QuestionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("question_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	questions: Schema.Array(QuestionItem)
})
export type QuestionRequestFact = typeof QuestionRequestFact.Type

export const PlanProposalFact = Schema.Struct({
	contractKind: Schema.Literal("plan_proposal"),
	planMarkdown: Schema.String,
	streaming: Schema.Boolean
})
export type PlanProposalFact = typeof PlanProposalFact.Type

export const UsageFact = Schema.Struct({
	contractKind: Schema.Literal("usage"),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	eventId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	cacheReadTokens: Schema.optionalKey(Schema.Number),
	cacheWriteTokens: Schema.optionalKey(Schema.Number),
	reasoningTokens: Schema.optionalKey(Schema.Number),
	contextWindowSize: Schema.optionalKey(Schema.Number)
})
export type UsageFact = typeof UsageFact.Type

export const ProviderSessionFact = Schema.Struct({
	contractKind: Schema.Literal("provider_session"),
	providerSessionId: Schema.String.check(Schema.isNonEmpty())
})
export type ProviderSessionFact = typeof ProviderSessionFact.Type

export const TurnCompleteFact = Schema.Struct({
	contractKind: Schema.Literal("turn_complete"),
	turnId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type TurnCompleteFact = typeof TurnCompleteFact.Type

export const TurnErrorFact = Schema.Struct({
	contractKind: Schema.Literal("turn_error"),
	detail: Schema.String.check(Schema.isNonEmpty()),
	turnId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type TurnErrorFact = typeof TurnErrorFact.Type

export const CodexContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	QuestionRequestFact,
	PlanProposalFact,
	UsageFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type CodexContractFact = typeof CodexContractFact.Type

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
})

export const isTurnTerminalFact = (fact: CodexContractFact): boolean =>
	fact.contractKind === "turn_complete" || fact.contractKind === "turn_error"
