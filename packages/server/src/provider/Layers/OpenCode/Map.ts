import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import {
	arrayField,
	booleanField,
	EMPTY_JSON_OBJECT,
	field,
	type Json,
	jsonObjectOf,
	type JsonObject,
	numberField,
	numberFieldAny,
	objectField,
	stringArrayField,
	stringField,
	stringFieldAny
} from "../Json.ts"
import {
	type OpenCodeContractFact,
	type OpenCodeToolStatus,
	type QuestionItem,
	type QuestionOption,
	toolCallUpdateFact,
	usageFact
} from "./Facts.ts"
import { OPENCODE_DEFAULT_MODE } from "./Provider.ts"
import { permissionRawInput, resolveOpenCodeToolKind } from "./Tools.ts"
import type { OpenCodeModel } from "./Wire.ts"

const MAX_CACHE_ENTRIES = 10_000

export type OpenCodeStreamState = {
	readonly providerSessionId: Option.Option<string>
	readonly currentMode: string
	readonly selectedModel: Option.Option<OpenCodeModel>
	readonly roles: HashMap.HashMap<string, string>
	readonly partText: HashMap.HashMap<string, string>
	readonly partType: HashMap.HashMap<string, string>
}

export const emptyOpenCodeStreamState: OpenCodeStreamState = {
	providerSessionId: Option.none(),
	currentMode: OPENCODE_DEFAULT_MODE,
	selectedModel: Option.none(),
	roles: HashMap.empty(),
	partText: HashMap.empty(),
	partType: HashMap.empty()
}

export type OpenCodeMapResult = {
	readonly facts: ReadonlyArray<OpenCodeContractFact>
	readonly state: OpenCodeStreamState
}

const rawInputOf = (value: Json | undefined): JsonObject => {
	if (value === undefined) {
		return EMPTY_JSON_OBJECT
	}
	return Option.getOrElse(jsonObjectOf(value), () => EMPTY_JSON_OBJECT)
}

const withProviderSession = (
	state: OpenCodeStreamState,
	sessionId: Option.Option<string>
): OpenCodeStreamState => {
	if (Option.isNone(sessionId) || Option.isSome(state.providerSessionId)) {
		return state
	}
	return {
		providerSessionId: sessionId,
		currentMode: state.currentMode,
		selectedModel: state.selectedModel,
		roles: state.roles,
		partText: state.partText,
		partType: state.partType
	}
}

const boundedMap = <K, V>(
	map: HashMap.HashMap<K, V>,
	key: K,
	value: V
): HashMap.HashMap<K, V> => {
	if (HashMap.size(map) < MAX_CACHE_ENTRIES) {
		return HashMap.set(map, key, value)
	}
	return HashMap.set(HashMap.empty<K, V>(), key, value)
}

const parseJsonText = (text: string): Option.Option<Json> => {
	const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Json))(text)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}

const envelopeOf = (
	record: JsonObject
): Option.Option<{ readonly eventType: string; readonly properties: JsonObject }> => {
	const nested = objectField(record, "payload")
	if (Option.isSome(nested)) {
		return envelopeOf(nested.value)
	}
	const eventType = stringField(record, "type")
	if (Option.isNone(eventType)) {
		return Option.none()
	}
	const properties = Option.getOrElse(objectField(record, "properties"), () => EMPTY_JSON_OBJECT)
	return Option.some({
		eventType: eventType.value,
		properties
	})
}

const cacheRole = (state: OpenCodeStreamState, messageId: string, role: string): OpenCodeStreamState => ({
	providerSessionId: state.providerSessionId,
	currentMode: state.currentMode,
	selectedModel: state.selectedModel,
	roles: boundedMap(state.roles, messageId, role),
	partText: state.partText,
	partType: state.partType
})

const cachePartType = (
	state: OpenCodeStreamState,
	partId: string,
	partType: string
): OpenCodeStreamState => ({
	providerSessionId: state.providerSessionId,
	currentMode: state.currentMode,
	selectedModel: state.selectedModel,
	roles: state.roles,
	partText: state.partText,
	partType: boundedMap(state.partType, partId, partType)
})

const resolveTextDelta = (
	state: OpenCodeStreamState,
	partId: string,
	messageId: string,
	partType: string,
	delta: Option.Option<string>,
	fullText: Option.Option<string>
): {
	readonly token: Option.Option<string>
	readonly state: OpenCodeStreamState
} => {
	const fallbackKey = `message:${messageId}:${partType}`
	const cached = Option.orElse(HashMap.get(state.partText, partId), () =>
		HashMap.get(state.partText, fallbackKey)
	)
	const writeCache = (nextText: string, nextState: OpenCodeStreamState): OpenCodeStreamState => ({
		providerSessionId: nextState.providerSessionId,
		currentMode: nextState.currentMode,
		selectedModel: nextState.selectedModel,
		roles: nextState.roles,
		partText: boundedMap(boundedMap(nextState.partText, partId, nextText), fallbackKey, nextText),
		partType: nextState.partType
	})
	if (Option.isSome(delta)) {
		const nextText = Option.match(fullText, {
			onNone: () =>
				Option.match(cached, {
					onNone: () => delta.value,
					onSome: (prev) => `${prev}${delta.value}`
				}),
			onSome: (full) => full
		})
		return {
			token: Option.some(delta.value),
			state: writeCache(nextText, state)
		}
	}
	if (Option.isSome(fullText)) {
		if (Option.isSome(cached)) {
			if (cached.value === fullText.value) {
				return {
					token: Option.none(),
					state
				}
			}
			if (fullText.value.startsWith(cached.value)) {
				const suffix = fullText.value.slice(cached.value.length)
				return {
					token: Str.isEmpty(suffix) ? Option.none() : Option.some(suffix),
					state: writeCache(fullText.value, state)
				}
			}
		}
		return {
			token: Option.some(fullText.value),
			state: writeCache(fullText.value, state)
		}
	}
	return {
		token: Option.none(),
		state
	}
}

const sessionIdFrom = (record: JsonObject): Option.Option<string> => {
	const direct = stringFieldAny(record, ["sessionID", "sessionId"])
	if (Option.isSome(direct)) {
		return direct
	}
	const part = objectField(record, "part")
	if (Option.isNone(part)) {
		return Option.none()
	}
	return stringFieldAny(part.value, ["sessionID", "sessionId"])
}

const mapToolStatus = (status: string): OpenCodeToolStatus => {
	if (status === "completed") {
		return "completed"
	}
	if (status === "error") {
		return "failed"
	}
	if (status === "running") {
		return "in_progress"
	}
	return "pending"
}

const cacheTokens = (
	tokens: JsonObject
): {
	readonly inputTokens: number | undefined
	readonly outputTokens: number | undefined
	readonly totalTokens: number | undefined
	readonly cacheReadTokens: number | undefined
	readonly cacheWriteTokens: number | undefined
} => {
	const cache = objectField(tokens, "cache")
	const cacheRead = Option.orElse(numberFieldAny(tokens, ["cache_read", "cacheRead"]), () =>
		Option.flatMap(cache, (nested) => numberField(nested, "read"))
	)
	const cacheWrite = Option.orElse(numberFieldAny(tokens, ["cache_write", "cacheWrite"]), () =>
		Option.flatMap(cache, (nested) => numberField(nested, "write"))
	)
	return {
		inputTokens: Option.getOrUndefined(numberFieldAny(tokens, ["input", "input_tokens"])),
		outputTokens: Option.getOrUndefined(numberFieldAny(tokens, ["output", "output_tokens"])),
		totalTokens: Option.getOrUndefined(numberFieldAny(tokens, ["total", "total_tokens"])),
		cacheReadTokens: Option.getOrUndefined(cacheRead),
		cacheWriteTokens: Option.getOrUndefined(cacheWrite)
	}
}

const noneResult = (state: OpenCodeStreamState): OpenCodeMapResult => ({
	facts: Arr.empty(),
	state
})

const factsResult = (
	state: OpenCodeStreamState,
	facts: ReadonlyArray<OpenCodeContractFact>
): OpenCodeMapResult => ({
	facts,
	state
})

const mapMessagePart = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult => {
	const part = objectField(properties, "part")
	if (Option.isNone(part)) {
		return noneResult(state)
	}
	const partId = stringField(part.value, "id")
	const messageId = stringFieldAny(part.value, ["messageID", "messageId"])
	const sessionId = stringFieldAny(part.value, ["sessionID", "sessionId"])
	const partType = Option.getOrElse(stringField(part.value, "type"), () => "")
	const reason = stringField(part.value, "reason")
	if (Option.isSome(reason) && reason.value === "stop") {
		return noneResult(state)
	}
	let next = withProviderSession(state, sessionId)
	if (Option.isSome(partId) && Str.isNonEmpty(partType)) {
		next = cachePartType(next, partId.value, partType)
	}
	const info = objectField(properties, "info")
	const incomingRole = Option.orElse(
		Option.flatMap(info, (record) => stringField(record, "role")),
		() => Option.orElse(stringField(properties, "role"), () => stringField(part.value, "role"))
	)
	if (Option.isSome(messageId) && Option.isSome(incomingRole)) {
		next = cacheRole(next, messageId.value, incomingRole.value)
	}
	const resolvedRole = Option.orElse(incomingRole, () =>
		Option.flatMap(messageId, (id) => HashMap.get(next.roles, id))
	)
	if (
		Option.isSome(resolvedRole) &&
		resolvedRole.value === "user" &&
		(partType === "text" || partType === "step-start" || partType === "reasoning")
	) {
		return noneResult(next)
	}
	if (partType === "step-finish") {
		if (Option.isNone(sessionId)) {
			return noneResult(next)
		}
		const tokens = Option.getOrElse(objectField(part.value, "tokens"), () => EMPTY_JSON_OBJECT)
		const counted = cacheTokens(tokens)
		const costUsd = Option.getOrUndefined(numberField(part.value, "cost"))
		return factsResult(next, [usageFact(sessionId.value, counted, costUsd)])
	}
	if (partType === "text" || partType === "step-start" || partType === "reasoning") {
		if (Option.isNone(partId) || Option.isNone(messageId)) {
			return noneResult(next)
		}
		const delta = Option.filter(stringField(properties, "delta"), (value) =>
			Str.isNonEmpty(value)
		)
		const fullText = Option.filter(stringField(part.value, "text"), (value) =>
			Str.isNonEmpty(value)
		)
		const resolved = resolveTextDelta(next, partId.value, messageId.value, partType, delta, fullText)
		if (Option.isNone(resolved.token)) {
			return noneResult(resolved.state)
		}
		if (partType === "reasoning") {
			return factsResult(resolved.state, [
				{
					contractKind: "thought_delta",
					token: resolved.token.value
				}
			])
		}
		return factsResult(resolved.state, [
			{
				contractKind: "text_delta",
				token: resolved.token.value
			}
		])
	}
	if (partType === "tool" || partType === "tool-invocation") {
		const toolName = Option.getOrElse(
			Option.orElse(stringField(part.value, "tool"), () => stringField(part.value, "name")),
			() => "Run"
		)
		const toolCallId = Option.getOrElse(
			stringFieldAny(part.value, ["callID", "callId"]),
			() => Option.getOrElse(partId, () => toolName)
		)
		const toolState = objectField(part.value, "state")
		const statusText = Option.getOrElse(
			Option.flatMap(toolState, (record) => stringField(record, "status")),
			() => "pending"
		)
		const toolInput = Option.flatMap(toolState, (record) => field(record, "input")).pipe(
			Option.orElse(() => field(part.value, "input")),
			Option.orElse(() => field(part.value, "arguments")),
			Option.getOrUndefined,
			rawInputOf
		)
		if (statusText === "completed") {
			const output = Option.flatMap(toolState, (record) => stringField(record, "output"))
			return factsResult(next, [toolCallUpdateFact(toolCallId, "completed", output)])
		}
		if (statusText === "error") {
			const errorText = Option.flatMap(toolState, (record) => stringField(record, "error"))
			return factsResult(next, [toolCallUpdateFact(toolCallId, "failed", errorText)])
		}
		return factsResult(next, [
			{
				contractKind: "tool_call",
				toolCallId,
				title: toolName,
				kind: resolveOpenCodeToolKind(toolName, toolInput),
				status: mapToolStatus(statusText),
				rawInput: toolInput
			}
		])
	}
	if (partType === "tool-result") {
		const toolCallId = Option.getOrElse(
			stringFieldAny(part.value, ["callID", "callId"]),
			() => Option.getOrElse(partId, () => "tool")
		)
		const output = Option.flatMap(objectField(part.value, "state"), (record) =>
			stringField(record, "output")
		)
		return factsResult(next, [toolCallUpdateFact(toolCallId, "completed", output)])
	}
	const fallbackText = Option.filter(stringField(part.value, "text"), (value) =>
		Str.isNonEmpty(value)
	)
	if (Option.isNone(fallbackText)) {
		return noneResult(next)
	}
	const token = Option.getOrElse(stringField(properties, "delta"), () => fallbackText.value)
	if (Str.isEmpty(token)) {
		return noneResult(next)
	}
	return factsResult(next, [
		{
			contractKind: "text_delta",
			token
		}
	])
}

const mapMessagePartDelta = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult => {
	const fieldName = stringField(properties, "field")
	const delta = stringField(properties, "delta")
	const partId = stringFieldAny(properties, ["partID", "partId"])
	const messageId = stringFieldAny(properties, ["messageID", "messageId"])
	if (
		Option.isNone(fieldName) ||
		fieldName.value !== "text" ||
		Option.isNone(delta) ||
		Option.isNone(partId) ||
		Option.isNone(messageId)
	) {
		return noneResult(state)
	}
	const partType = Option.getOrElse(HashMap.get(state.partType, partId.value), () => "text")
	const role = HashMap.get(state.roles, messageId.value)
	if (
		Option.isSome(role) &&
		role.value === "user" &&
		(partType === "text" || partType === "reasoning")
	) {
		return noneResult(state)
	}
	const resolved = resolveTextDelta(
		withProviderSession(state, stringFieldAny(properties, ["sessionID", "sessionId"])),
		partId.value,
		messageId.value,
		partType,
		delta,
		Option.none()
	)
	if (Option.isNone(resolved.token)) {
		return noneResult(resolved.state)
	}
	if (partType === "reasoning") {
		return factsResult(resolved.state, [
			{
				contractKind: "thought_delta",
				token: resolved.token.value
			}
		])
	}
	return factsResult(resolved.state, [
		{
			contractKind: "text_delta",
			token: resolved.token.value
		}
	])
}

const mapPermissionAsked = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult => {
	const id = stringField(properties, "id")
	const sessionId = stringFieldAny(properties, ["sessionID", "sessionId"])
	const permission = stringField(properties, "permission")
	if (Option.isNone(id) || Option.isNone(sessionId) || Option.isNone(permission)) {
		return noneResult(state)
	}
	const patterns = stringArrayField(properties, "patterns")
	return factsResult(withProviderSession(state, sessionId), [
		{
			contractKind: "permission_request",
			id: id.value,
			sessionId: sessionId.value,
			permission: permission.value,
			patterns,
			always: stringArrayField(properties, "always"),
			rawInput: permissionRawInput(permission.value, patterns)
		}
	])
}

const questionOptionFromJson = (option: Json): Option.Option<QuestionOption> => {
	const optionRecord = jsonObjectOf(option)
	if (Option.isNone(optionRecord)) {
		return Option.none()
	}
	return Option.some({
		label: Option.getOrElse(stringField(optionRecord.value, "label"), () => ""),
		description: Option.getOrElse(stringField(optionRecord.value, "description"), () => "")
	})
}

const questionItemFromJson = (item: Json): Option.Option<QuestionItem> => {
	const record = jsonObjectOf(item)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const question = stringField(record.value, "question")
	if (Option.isNone(question)) {
		return Option.none()
	}
	const optionsJson = Option.getOrElse(arrayField(record.value, "options"), () => Arr.empty<Json>())
	return Option.some({
		question: question.value,
		header: Option.getOrElse(stringField(record.value, "header"), () => question.value),
		options: Arr.filterMap(optionsJson, Filter.fromPredicateOption(questionOptionFromJson)),
		multiSelect: Option.getOrElse(booleanField(record.value, "multiSelect"), () => false)
	})
}

const mapQuestionAsked = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult => {
	const id = stringField(properties, "id")
	const sessionId = stringFieldAny(properties, ["sessionID", "sessionId"])
	const questionsJson = arrayField(properties, "questions")
	if (Option.isNone(id) || Option.isNone(sessionId) || Option.isNone(questionsJson)) {
		return noneResult(state)
	}
	return factsResult(withProviderSession(state, sessionId), [
		{
			contractKind: "question_request",
			id: id.value,
			sessionId: sessionId.value,
			questions: Arr.filterMap(
				questionsJson.value,
				Filter.fromPredicateOption(questionItemFromJson)
			)
		}
	])
}

const mapIdleOrComplete = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult =>
	factsResult(withProviderSession(state, sessionIdFrom(properties)), [
		{
			contractKind: "turn_complete"
		}
	])

const mapSessionError = (
	state: OpenCodeStreamState,
	properties: JsonObject
): OpenCodeMapResult => {
	const error = objectField(properties, "error")
	const detail = Option.getOrElse(
		Option.orElse(
			Option.flatMap(error, (record) => stringField(record, "message")),
			() => stringField(properties, "message")
		),
		() => "OpenCode session failed"
	)
	return factsResult(withProviderSession(state, sessionIdFrom(properties)), [
		{
			contractKind: "turn_error",
			detail
		}
	])
}

export const sseSessionId = (raw: Json): Option.Option<string> => {
	const record = jsonObjectOf(raw)
	if (Option.isNone(record)) {
		return Option.none()
	}
	const envelope = envelopeOf(record.value)
	if (Option.isNone(envelope)) {
		return sessionIdFrom(record.value)
	}
	return sessionIdFrom(envelope.value.properties)
}

export const mapSseJson = (state: OpenCodeStreamState, raw: Json): OpenCodeMapResult => {
	const record = jsonObjectOf(raw)
	if (Option.isNone(record)) {
		return noneResult(state)
	}
	const envelope = envelopeOf(record.value)
	if (Option.isNone(envelope)) {
		return noneResult(state)
	}
	const eventType = envelope.value.eventType
	const properties = envelope.value.properties
	if (eventType === "message.part.updated") {
		return mapMessagePart(state, properties)
	}
	if (eventType === "message.part.delta") {
		return mapMessagePartDelta(state, properties)
	}
	if (eventType === "message.updated") {
		const info = objectField(properties, "info")
		const messageId = Option.flatMap(info, (record) => stringField(record, "id"))
		const role = Option.flatMap(info, (record) => stringField(record, "role"))
		if (Option.isSome(messageId) && Option.isSome(role)) {
			return noneResult(cacheRole(state, messageId.value, role.value))
		}
		return noneResult(state)
	}
	if (eventType === "permission.asked") {
		return mapPermissionAsked(state, properties)
	}
	if (eventType === "question.asked") {
		return mapQuestionAsked(state, properties)
	}
	if (eventType === "session.idle") {
		return mapIdleOrComplete(state, properties)
	}
	if (eventType === "session.status") {
		const status = objectField(properties, "status")
		const statusName = Option.flatMap(status, (record) =>
			Option.orElse(stringField(record, "state"), () => stringField(record, "type"))
		)
		if (Option.isSome(statusName) && statusName.value === "idle") {
			return mapIdleOrComplete(state, properties)
		}
		return noneResult(withProviderSession(state, sessionIdFrom(properties)))
	}
	if (eventType === "session.error") {
		return mapSessionError(state, properties)
	}
	if (eventType === "session.created") {
		const info = objectField(properties, "info")
		const providerSessionId = Option.flatMap(info, (record) => stringField(record, "id"))
		if (Option.isNone(providerSessionId)) {
			return noneResult(state)
		}
		return factsResult(withProviderSession(state, providerSessionId), [
			{
				contractKind: "provider_session",
				providerSessionId: providerSessionId.value
			}
		])
	}
	return noneResult(state)
}

export const mapSseText = (state: OpenCodeStreamState, text: string): OpenCodeMapResult => {
	const parsed = parseJsonText(text)
	if (Option.isNone(parsed)) {
		return noneResult(state)
	}
	return mapSseJson(state, parsed.value)
}
