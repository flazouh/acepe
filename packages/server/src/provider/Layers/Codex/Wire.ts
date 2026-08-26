import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Str from "effect/String"
import { type Json, type JsonObject, jsonObjectOf, objectField, stringField } from "../Json.ts"
import {
	CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
	CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
	type CodexMode,
	type CodexNativeConfigState,
	resolveCodexModeId
} from "./Provider.ts"

export const COMMAND_APPROVAL_METHOD = "item/commandExecution/requestApproval"
export const FILE_READ_APPROVAL_METHOD = "item/fileRead/requestApproval"
export const FILE_CHANGE_APPROVAL_METHOD = "item/fileChange/requestApproval"
export const USER_INPUT_REQUEST_METHOD = "item/tool/requestUserInput"
export const AGENT_MESSAGE_DELTA_METHOD = "item/agentMessage/delta"
export const REASONING_TEXT_DELTA_METHOD = "item/reasoning/textDelta"
export const REASONING_SUMMARY_DELTA_METHOD = "item/reasoning/summaryTextDelta"
export const TURN_COMPLETED_METHOD = "turn/completed"
export const ERROR_METHOD = "error"
export const ITEM_STARTED_METHOD = "item/started"
export const ITEM_COMPLETED_METHOD = "item/completed"
export const TOKEN_USAGE_UPDATED_METHOD = "thread/tokenUsage/updated"
export const ACCOUNT_RATE_LIMITS_UPDATED_METHOD = "account/rateLimits/updated"

export const stringifyJsonRpcId = (value: Option.Option<Json>): Option.Option<string> =>
	Option.flatMap(value, (id) => {
		if (Predicate.isString(id) && Str.isNonEmpty(Str.trim(id))) {
			return Option.some(id)
		}
		if (Predicate.isNumber(id)) {
			return Option.some(String(id))
		}
		return Option.none()
	})

export const buildCodexInitializeParams = (): JsonObject => ({
	clientInfo: {
		name: "acepe_desktop",
		title: "Acepe Desktop",
		version: "0.0.1"
	},
	capabilities: {
		experimentalApi: true
	}
})

export const buildThreadStartParams = (cwd: string): JsonObject => ({
	cwd,
	experimentalRawEvents: false,
	persistExtendedHistory: true
})

export const buildThreadResumeParams = (threadId: string, cwd: string): JsonObject => ({
	threadId,
	cwd,
	persistExtendedHistory: true
})

export const buildTurnInterruptParams = (threadId: string, turnId: string): JsonObject => ({
	threadId,
	turnId
})

const collaborationSettings = (
	state: CodexNativeConfigState,
	instructions: string
): JsonObject => ({
	model: state.currentModelId,
	reasoning_effort: state.reasoningEffort,
	developer_instructions: instructions
})

export const buildCodexTurnStartParams = (input: {
	readonly threadId: string
	readonly text: string
	readonly state: CodexNativeConfigState
	readonly modeId: string
}): JsonObject => {
	const fallbackMode: CodexMode = "agent"
	const mode = Option.getOrElse(resolveCodexModeId(input.modeId), () => fallbackMode)
	const collaborationMode: JsonObject =
		mode === "plan"
			? {
					mode: "plan",
					settings: collaborationSettings(input.state, CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS)
				}
			: {
					mode: "default",
					settings: collaborationSettings(
						input.state,
						CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS
					)
				}
	const threadId = input.threadId
	const textInput: Json = [
		{
			type: "text",
			text: input.text,
			text_elements: []
		}
	]
	const model = input.state.currentModelId
	const effort = input.state.reasoningEffort
	if (input.state.fastMode === false) {
		return {
			threadId,
			input: textInput,
			model,
			effort,
			collaborationMode
		}
	}
	return {
		threadId,
		input: textInput,
		model,
		effort,
		collaborationMode,
		serviceTier: "fast"
	}
}

export const parseThreadId = (result: Json): Option.Option<string> => {
	const record = jsonObjectOf(result)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const nested = Option.flatMap(objectField(record.value, "thread"), (thread) =>
		stringField(thread, "id")
	)
	return Option.orElse(nested, () => stringField(record.value, "threadId"))
}

export const parseTurnId = (result: Json): Option.Option<string> => {
	const record = jsonObjectOf(result)
	if (Option.isNone(record)) {
		return Option.none()
	}
	return Option.flatMap(objectField(record.value, "turn"), (turn) => stringField(turn, "id"))
}
