import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}

export const CURSOR_ACP_TOOL_KINDS = [
	"read",
	"edit",
	"delete",
	"move",
	"search",
	"execute",
	"think",
	"fetch",
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
	status: Schema.optionalKey(CursorToolStatus)
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

const decodeFact = Schema.decodeUnknownExit(CursorContractFact)
const encodeFact = Schema.encodeUnknownExit(CursorContractFact)
const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const decodeToolKind = Schema.decodeUnknownExit(CursorAcpToolKind)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

const jsonObjectOf = (value: Json): Option.Option<JsonObject> => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return Option.some(exit.value)
	}
	return Option.none()
}

const field = (record: JsonObject, key: string): Option.Option<Json> => {
	const value = record[key]
	if (value === undefined) {
		return Option.none()
	}
	return Option.some(value)
}

const stringField = (record: JsonObject, key: string): Option.Option<string> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))
			? Option.some(value)
			: Option.none()
	)

const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
	Option.flatMap(field(record, key), jsonObjectOf)

const arrayField = (record: JsonObject, key: string): Option.Option<ReadonlyArray<Json>> =>
	Option.flatMap(field(record, key), (value) => (isJsonArray(value) ? Option.some(value) : Option.none()))

const asToolStatus = (value: string): Option.Option<CursorToolStatus> => {
	if (value === "pending" || value === "in_progress" || value === "completed" || value === "failed") {
		return Option.some(value)
	}
	return Option.none()
}

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(Str.trim(name)))

export const detectCursorToolKind = (name: string): CursorAcpToolKind => {
	const folded = foldedName(name)
	if (folded === "read" || folded === "readfile" || folded === "view") {
		return "read"
	}
	if (
		folded === "edit" ||
		folded === "write" ||
		folded === "writefile" ||
		folded === "stredit" ||
		folded === "applypatch"
	) {
		return "edit"
	}
	if (folded === "delete" || folded === "removefile") {
		return "delete"
	}
	if (folded === "move" || folded === "rename") {
		return "move"
	}
	if (folded === "search" || folded === "grep" || folded === "glob") {
		return "search"
	}
	if (
		folded === "execute" ||
		folded === "bash" ||
		folded === "shell" ||
		folded === "run" ||
		folded === "terminal"
	) {
		return "execute"
	}
	if (folded === "think") {
		return "think"
	}
	if (folded === "fetch" || folded === "webfetch" || folded === "websearch") {
		return "fetch"
	}
	const decoded = decodeToolKind(name)
	if (Exit.isSuccess(decoded)) {
		return decoded.value
	}
	return "other"
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

const optionKindAllows = (kind: string, decision: "allow" | "deny"): boolean => {
	if (decision === "allow") {
		return kind === "allow_once" || kind === "allow_always"
	}
	return kind === "reject_once" || kind === "reject_always"
}

const optionIdIfKind = (
	entry: Json,
	decision: "allow" | "deny"
): Option.Option<string> => {
	const record = jsonObjectOf(entry)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const kind = stringField(record.value, "kind")
	const optionId = stringField(record.value, "optionId")
	if (Option.isNone(kind) || Option.isNone(optionId)) {
		return Option.none()
	}
	if (optionKindAllows(kind.value, decision) === false) {
		return Option.none()
	}
	return Option.some(optionId.value)
}

export const selectPermissionOptionId = (
	request: Json,
	decision: "allow" | "deny"
): Option.Option<string> => {
	const record = jsonObjectOf(request)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const options = arrayField(record.value, "options")
	if (Option.isNone(options)) {
		return Option.none()
	}
	return Arr.head(
		Arr.filterMap(
			options.value,
			Filter.fromPredicateOption((entry) => optionIdIfKind(entry, decision))
		)
	)
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

export const encodeContractFact = (fact: CursorContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<CursorContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}

export const providerSessionFact = (providerSessionId: string): ProviderSessionFact => ({
	contractKind: "provider_session",
	providerSessionId
})

export const turnCompleteFact: TurnCompleteFact = {
	contractKind: "turn_complete"
}
