import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export const OPENCODE_TOOL_KINDS = [
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
export const OpenCodeToolKind = Schema.Literals(OPENCODE_TOOL_KINDS)
export type OpenCodeToolKind = typeof OpenCodeToolKind.Type

export const OpenCodeToolStatus = Schema.Literals(["pending", "in_progress", "completed", "failed"])
export type OpenCodeToolStatus = typeof OpenCodeToolStatus.Type

export const OpenCodePermissionReply = Schema.Literals(["once", "always", "reject"])
export type OpenCodePermissionReply = typeof OpenCodePermissionReply.Type

export const OpenCodeModel = Schema.Struct({
	providerId: Schema.String.check(Schema.isNonEmpty()),
	modelId: Schema.String.check(Schema.isNonEmpty())
})
export type OpenCodeModel = typeof OpenCodeModel.Type

export const OpenCodeSessionRecord = Schema.Struct({
	id: Schema.String.check(Schema.isNonEmpty()),
	directory: Schema.String.check(Schema.isNonEmpty()),
	projectID: Schema.String.check(Schema.isNonEmpty()),
	title: Schema.optionalKey(Schema.String)
})
export type OpenCodeSessionRecord = typeof OpenCodeSessionRecord.Type

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
	kind: OpenCodeToolKind,
	status: OpenCodeToolStatus,
	rawInput: Schema.JsonObject
})
export type ToolCallFact = typeof ToolCallFact.Type

export const ToolCallUpdateFact = Schema.Struct({
	contractKind: Schema.Literal("tool_call_update"),
	toolCallId: Schema.String.check(Schema.isNonEmpty()),
	status: Schema.optionalKey(OpenCodeToolStatus),
	partialJson: Schema.optionalKey(Schema.String)
})
export type ToolCallUpdateFact = typeof ToolCallUpdateFact.Type

export const PermissionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("permission_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	permission: Schema.String.check(Schema.isNonEmpty()),
	patterns: Schema.Array(Schema.String),
	always: Schema.Array(Schema.String),
	rawInput: Schema.JsonObject
})
export type PermissionRequestFact = typeof PermissionRequestFact.Type

export const QuestionOption = Schema.Struct({
	label: Schema.String,
	description: Schema.String
})
export type QuestionOption = typeof QuestionOption.Type

export const QuestionItem = Schema.Struct({
	question: Schema.String,
	header: Schema.String,
	options: Schema.Array(QuestionOption),
	multiSelect: Schema.Boolean
})
export type QuestionItem = typeof QuestionItem.Type

export const QuestionRequestFact = Schema.Struct({
	contractKind: Schema.Literal("question_request"),
	id: Schema.String.check(Schema.isNonEmpty()),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	questions: Schema.Array(QuestionItem)
})
export type QuestionRequestFact = typeof QuestionRequestFact.Type

export const UsageFact = Schema.Struct({
	contractKind: Schema.Literal("usage"),
	sessionId: Schema.String.check(Schema.isNonEmpty()),
	inputTokens: Schema.optionalKey(Schema.Number),
	outputTokens: Schema.optionalKey(Schema.Number),
	totalTokens: Schema.optionalKey(Schema.Number),
	costUsd: Schema.optionalKey(Schema.Number),
	cacheReadTokens: Schema.optionalKey(Schema.Number),
	cacheWriteTokens: Schema.optionalKey(Schema.Number)
})
export type UsageFact = typeof UsageFact.Type

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

export const SessionCatalogFact = Schema.Struct({
	contractKind: Schema.Literal("session_catalog"),
	models: Schema.Array(
		Schema.Struct({
			modelId: Schema.String.check(Schema.isNonEmpty()),
			name: Schema.String.check(Schema.isNonEmpty())
		})
	),
	currentModelId: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
	modes: Schema.Array(
		Schema.Struct({
			id: Schema.String.check(Schema.isNonEmpty()),
			name: Schema.String.check(Schema.isNonEmpty())
		})
	),
	currentModeId: Schema.String.check(Schema.isNonEmpty()),
	commands: Schema.Array(
		Schema.Struct({
			name: Schema.String.check(Schema.isNonEmpty()),
			description: Schema.String
		})
	)
})
export type SessionCatalogFact = typeof SessionCatalogFact.Type

export const OpenCodeContractFact = Schema.Union([
	TextDeltaFact,
	ThoughtDeltaFact,
	ToolCallFact,
	ToolCallUpdateFact,
	PermissionRequestFact,
	QuestionRequestFact,
	UsageFact,
	ProviderSessionFact,
	TurnCompleteFact,
	TurnErrorFact,
	SessionCatalogFact
])
export type OpenCodeContractFact = typeof OpenCodeContractFact.Type

export const withCompactCommand = (
	commands: ReadonlyArray<{ readonly name: string; readonly description: string }>
): ReadonlyArray<{ readonly name: string; readonly description: string }> => {
	if (Arr.some(commands, (command) => command.name === "compact")) {
		return commands
	}
	return Arr.append(commands, {
		name: "compact",
		description: "compact the session"
	})
}

const withUsageNumber = (
	fact: UsageFact,
	key:
		| "inputTokens"
		| "outputTokens"
		| "totalTokens"
		| "costUsd"
		| "cacheReadTokens"
		| "cacheWriteTokens",
	value: number | undefined
): UsageFact => {
	if (value === undefined) {
		return fact
	}
	if (key === "inputTokens") {
		return {
			...fact,
			inputTokens: value
		}
	}
	if (key === "outputTokens") {
		return {
			...fact,
			outputTokens: value
		}
	}
	if (key === "totalTokens") {
		return {
			...fact,
			totalTokens: value
		}
	}
	if (key === "costUsd") {
		return {
			...fact,
			costUsd: value
		}
	}
	if (key === "cacheReadTokens") {
		return {
			...fact,
			cacheReadTokens: value
		}
	}
	return {
		...fact,
		cacheWriteTokens: value
	}
}

export const usageFact = (
	sessionId: string,
	counted: {
		readonly inputTokens: number | undefined
		readonly outputTokens: number | undefined
		readonly totalTokens: number | undefined
		readonly cacheReadTokens: number | undefined
		readonly cacheWriteTokens: number | undefined
	},
	costUsd: number | undefined
): UsageFact => {
	const base: UsageFact = {
		contractKind: "usage",
		sessionId
	}
	return withUsageNumber(
		withUsageNumber(
			withUsageNumber(
				withUsageNumber(
					withUsageNumber(
						withUsageNumber(base, "inputTokens", counted.inputTokens),
						"outputTokens",
						counted.outputTokens
					),
					"totalTokens",
					counted.totalTokens
				),
				"costUsd",
				costUsd
			),
			"cacheReadTokens",
			counted.cacheReadTokens
		),
		"cacheWriteTokens",
		counted.cacheWriteTokens
	)
}

export const toolCallUpdateFact = (
	toolCallId: string,
	status: OpenCodeToolStatus,
	partialJson: Option.Option<string>
): ToolCallUpdateFact => {
	if (Option.isNone(partialJson)) {
		return {
			contractKind: "tool_call_update",
			toolCallId,
			status
		}
	}
	return {
		contractKind: "tool_call_update",
		toolCallId,
		status,
		partialJson: partialJson.value
	}
}

export const sessionCatalogFact = (input: {
	readonly models: ReadonlyArray<{ readonly modelId: string; readonly name: string }>
	readonly currentModelId: Option.Option<string>
	readonly currentModeId: string
	readonly commands: ReadonlyArray<{ readonly name: string; readonly description: string }>
}): SessionCatalogFact => {
	const currentModelId = Option.getOrUndefined(input.currentModelId)
	if (currentModelId === undefined) {
		return {
			contractKind: "session_catalog",
			models: input.models,
			modes: [
				{
					id: "build",
					name: "Build"
				},
				{
					id: "plan",
					name: "Plan"
				}
			],
			currentModeId: input.currentModeId,
			commands: withCompactCommand(input.commands)
		}
	}
	return {
		contractKind: "session_catalog",
		models: input.models,
		currentModelId,
		modes: [
			{
				id: "build",
				name: "Build"
			},
			{
				id: "plan",
				name: "Plan"
			}
		],
		currentModeId: input.currentModeId,
		commands: withCompactCommand(input.commands)
	}
}

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
})
