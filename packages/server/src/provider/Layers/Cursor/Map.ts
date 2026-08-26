import * as Arr from "effect/Array"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import {
	arrayField,
	EMPTY_JSON_OBJECT,
	field,
	type Json,
	type JsonObject,
	jsonObjectOf,
	objectField,
	stringField
} from "../Json.ts"
import type { CursorContractFact, CursorToolStatus, PermissionRequestFact } from "./Facts.ts"
import { detectCursorToolKind, permissionIdForToolCall } from "./Tools.ts"

const asToolStatus = (value: string): Option.Option<CursorToolStatus> => {
	if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
		return Option.some(value)
	}
	return Option.none()
}

const textFromContent = (content: JsonObject): Option.Option<string> => {
	const typeName = Option.getOrElse(stringField(content, "type"), () => "")
	if (typeName !== "text") {
		return Option.none()
	}
	return stringField(content, "text")
}

const rawInputOf = (value: Option.Option<Json>): JsonObject =>
	Option.getOrElse(Option.flatMap(value, jsonObjectOf), () => EMPTY_JSON_OBJECT)

const mapMessageChunk = (
	update: JsonObject,
	contractKind: "text_delta" | "thought_delta"
): Option.Option<CursorContractFact> => {
	const content = objectField(update, "content")
	if (Option.isNone(content)) {
		return Option.none()
	}
	const token = textFromContent(content.value)
	if (Option.isNone(token)) {
		return Option.none()
	}
	if (contractKind === "text_delta") {
		return Option.some({ contractKind: "text_delta", token: token.value })
	}
	return Option.some({ contractKind: "thought_delta", token: token.value })
}

const mapToolCall = (update: JsonObject): Option.Option<CursorContractFact> => {
	const toolCallId = stringField(update, "toolCallId")
	if (Option.isNone(toolCallId)) {
		return Option.none()
	}
	const status = Option.flatMap(stringField(update, "status"), asToolStatus)
	if (Option.isNone(status)) {
		return Option.none()
	}
	const kindName = Option.getOrElse(stringField(update, "kind"), () =>
		Option.getOrElse(stringField(update, "title"), () => "other")
	)
	const title = Option.getOrElse(stringField(update, "title"), () => kindName)
	return Option.some({
		contractKind: "tool_call",
		toolCallId: toolCallId.value,
		title,
		kind: detectCursorToolKind(kindName),
		status: status.value,
		rawInput: rawInputOf(field(update, "rawInput"))
	})
}

const mapToolCallUpdate = (update: JsonObject): Option.Option<CursorContractFact> => {
	const toolCallId = stringField(update, "toolCallId")
	if (Option.isNone(toolCallId)) {
		return Option.none()
	}
	const status = Option.flatMap(stringField(update, "status"), asToolStatus)
	if (Option.isNone(status)) {
		return Option.some({
			contractKind: "tool_call_update",
			toolCallId: toolCallId.value
		})
	}
	return Option.some({
		contractKind: "tool_call_update",
		toolCallId: toolCallId.value,
		status: status.value
	})
}

const planLine = (entry: Json): Option.Option<string> => {
	const record = jsonObjectOf(entry)
	if (Option.isNone(record)) {
		return Option.none()
	}
	return stringField(record.value, "content")
}

const mapPlan = (update: JsonObject): Option.Option<CursorContractFact> => {
	const entries = arrayField(update, "entries")
	if (Option.isNone(entries)) {
		return Option.none()
	}
	const lines = Arr.filterMap(entries.value, Filter.fromPredicateOption(planLine))
	if (!Arr.isReadonlyArrayNonEmpty(lines)) {
		return Option.none()
	}
	return Option.some({
		contractKind: "plan_proposal",
		planMarkdown: Arr.join(lines, "\n")
	})
}

export const mapAcpSessionNotification = (value: Json): Option.Option<CursorContractFact> => {
	const record = jsonObjectOf(value)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const update = objectField(record.value, "update")
	if (Option.isNone(update)) {
		return Option.none()
	}
	const sessionUpdate = Option.getOrElse(stringField(update.value, "sessionUpdate"), () => "")
	if (sessionUpdate === "agent_message_chunk") {
		return mapMessageChunk(update.value, "text_delta")
	}
	if (sessionUpdate === "agent_thought_chunk") {
		return mapMessageChunk(update.value, "thought_delta")
	}
	if (sessionUpdate === "tool_call") {
		return mapToolCall(update.value)
	}
	if (sessionUpdate === "tool_call_update") {
		return mapToolCallUpdate(update.value)
	}
	if (sessionUpdate === "plan") {
		return mapPlan(update.value)
	}
	return Option.none()
}

export const mapAcpPermissionRequest = (value: Json): Option.Option<PermissionRequestFact> => {
	const record = jsonObjectOf(value)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const sessionId = stringField(record.value, "sessionId")
	const toolCall = objectField(record.value, "toolCall")
	if (Option.isNone(sessionId) || Option.isNone(toolCall)) {
		return Option.none()
	}
	const toolCallId = stringField(toolCall.value, "toolCallId")
	if (Option.isNone(toolCallId)) {
		return Option.none()
	}
	const kindName = Option.getOrElse(stringField(toolCall.value, "kind"), () =>
		Option.getOrElse(stringField(toolCall.value, "title"), () => "other")
	)
	return Option.some({
		contractKind: "permission_request",
		id: permissionIdForToolCall(toolCallId.value),
		sessionId: sessionId.value,
		permission: detectCursorToolKind(kindName),
		toolCallId: toolCallId.value
	})
}

const CURSOR_EXTENSION_METHODS = [
	"cursor/ask_question",
	"cursor/create_plan",
	"cursor/update_todos",
	"cursor/task",
	"cursor/generate_image"
] as const

const stripUnderscorePrefix = (method: string): string => {
	if (Str.startsWith("_")(method)) {
		return method.slice(1)
	}
	return method
}

export const mapCursorExtensionMethod = (method: string): Option.Option<CursorContractFact> => {
	const normalized = stripUnderscorePrefix(method)
	if (Arr.contains(CURSOR_EXTENSION_METHODS, normalized)) {
		return Option.none()
	}
	return Option.none()
}
