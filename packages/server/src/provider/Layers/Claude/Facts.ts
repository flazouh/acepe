import * as Schema from "effect/Schema"

export const CLAUDE_ACP_TOOL_KINDS = [
	"read",
	"read_lints",
	"edit",
	"execute",
	"search",
	"glob",
	"fetch",
	"web_search",
	"think",
	"todo",
	"question",
	"task",
	"skill",
	"enter_plan_mode",
	"exit_plan_mode",
	"other"
] as const
export const ClaudeAcpToolKind = Schema.Literals(CLAUDE_ACP_TOOL_KINDS)
export type ClaudeAcpToolKind = typeof ClaudeAcpToolKind.Type

export const ClaudeToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type ClaudeToolStatus = typeof ClaudeToolStatus.Type

export const ClaudeCompactionStatus = Schema.Literals([
	"preparing",
	"completed",
	"usage_reset",
	"failed"
])
export type ClaudeCompactionStatus = typeof ClaudeCompactionStatus.Type

export const ClaudeCompactionTrigger = Schema.Literals(["auto", "manual", "unknown"])
export type ClaudeCompactionTrigger = typeof ClaudeCompactionTrigger.Type

export type ClaudePermissionDecision = "allow" | "deny"

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
	kind: ClaudeAcpToolKind,
	status: ClaudeToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: Schema.optionalKey(ClaudeToolStatus),
	partialJson: Schema.optionalKey(Schema.String)
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
	planMarkdown: Schema.String.check(Schema.isNonEmpty()),
	toolCallId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()))
})
export type PlanProposalFact = typeof PlanProposalFact.Type

export const CompactionFact = Schema.Struct({
	contractKind: Schema.Literal("compaction"),
	eventId: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	status: ClaudeCompactionStatus,
	trigger: ClaudeCompactionTrigger,
	preCompactionTokens: Schema.optionalKey(Schema.Number),
	postCompactionTokens: Schema.optionalKey(Schema.Number),
	durationMs: Schema.optionalKey(Schema.Number),
	preservedMessageCount: Schema.optionalKey(Schema.Number),
	cumulativeDroppedTokens: Schema.optionalKey(Schema.Number),
	timestampMs: Schema.optionalKey(Schema.Number),
	providerMetadata: Schema.optionalKey(Schema.JsonObject)
})
export type CompactionFact = typeof CompactionFact.Type

export const UsageFact = Schema.Struct({
	contractKind: Schema.Literal("usage"),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	costUsd: Schema.optionalKey(Schema.Number),
	contextWindowSize: Schema.optionalKey(Schema.Number)
})
export type UsageFact = typeof UsageFact.Type

export const DeferredOpenFact = Schema.Struct({
	contractKind: Schema.Literal("deferred_open"),
	canonicalReady: Schema.Boolean
})
export type DeferredOpenFact = typeof DeferredOpenFact.Type

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

export const ClaudeContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	PlanProposalFact,
	CompactionFact,
	UsageFact,
	DeferredOpenFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact
])
export type ClaudeContractFact = typeof ClaudeContractFact.Type

export const planProposalFact = (input: {
	readonly planMarkdown: string
	readonly toolCallId: string
}): PlanProposalFact => ({
	contractKind: "plan_proposal",
	planMarkdown: input.planMarkdown,
	toolCallId: input.toolCallId
})

export const deferredOpenFact: DeferredOpenFact = {
	contractKind: "deferred_open",
	canonicalReady: false
}

export const isTurnTerminalFact = (fact: ClaudeContractFact): boolean =>
	fact.contractKind === "turn_complete" || fact.contractKind === "turn_error"
