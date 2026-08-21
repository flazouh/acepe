import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { OPENCODE_DEFAULT_MODE } from "./OpenCodeProvider.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const EMPTY_JSON_OBJECT: JsonObject = {}
const MAX_CACHE_ENTRIES = 10_000
const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))

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

const encodeFact = Schema.encodeUnknownExit(OpenCodeContractFact)
const decodeFact = Schema.decodeUnknownExit(OpenCodeContractFact)

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

export type SseLineFold = {
	readonly pending: ReadonlyArray<string>
}

export const emptySseLineFold: SseLineFold = {
	pending: Arr.empty()
}

export type OpenCodeUrls = {
	readonly baseUrl: string
	readonly session: string
	readonly config: string
	readonly provider: string
	readonly command: string
	readonly globalEvent: string
	readonly promptAsync: (sessionId: string) => string
	readonly abort: (sessionId: string) => string
	readonly permissionReply: (requestId: string) => string
	readonly questionReply: (requestId: string) => string
}

export type OpenCodePromptBody = {
	readonly directory: string
	readonly model: {
		readonly providerID: string
		readonly modelID: string
	}
	readonly agent: string
	readonly parts: ReadonlyArray<{
		readonly type: "text"
		readonly text: string
	}>
}

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

const stringFieldAny = (record: JsonObject, keys: ReadonlyArray<string>): Option.Option<string> =>
	Arr.reduce(keys, Option.none<string>(), (found, key) =>
		Option.isSome(found) ? found : stringField(record, key)
	)

const numberField = (record: JsonObject, key: string): Option.Option<number> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isNumber(value) ? Option.some(value) : Option.none()
	)

const numberFieldAny = (record: JsonObject, keys: ReadonlyArray<string>): Option.Option<number> =>
	Arr.reduce(keys, Option.none<number>(), (found, key) =>
		Option.isSome(found) ? found : numberField(record, key)
	)

const booleanField = (record: JsonObject, key: string): Option.Option<boolean> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isBoolean(value) ? Option.some(value) : Option.none()
	)

const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
	Option.flatMap(field(record, key), jsonObjectOf)

const arrayField = (record: JsonObject, key: string): Option.Option<ReadonlyArray<Json>> =>
	Option.flatMap(field(record, key), (value) =>
		isJsonArray(value) ? Option.some(value) : Option.none()
	)

const stringArrayField = (record: JsonObject, key: string): ReadonlyArray<string> =>
	Option.match(arrayField(record, key), {
		onNone: () => Arr.empty<string>(),
		onSome: (items) =>
			Arr.filterMap(
				items,
				Filter.fromPredicateOption((item) =>
					Predicate.isString(item) && Str.isNonEmpty(Str.trim(item))
						? Option.some(item)
						: Option.none()
				)
			)
	})

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

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(Str.trim(name)))

const nameIn = (folded: string, candidates: ReadonlyArray<string>): boolean =>
	Arr.some(candidates, (candidate) => folded === foldedName(candidate))

export const detectOpenCodeToolKind = (name: string): OpenCodeToolKind => {
	const folded = foldedName(name)
	if (
		nameIn(folded, [
			"read",
			"readfile",
			"read_file",
			"cat",
			"view",
			"viewfile",
			"view_file",
			"notebookread",
			"notebook_read"
		])
	) {
		return "read"
	}
	if (nameIn(folded, ["read_lints", "readlints", "read-lints", "read lints"])) {
		return "read_lints"
	}
	if (
		nameIn(folded, [
			"edit",
			"editfile",
			"edit_file",
			"modify",
			"write",
			"writefile",
			"create",
			"replace",
			"str_replace",
			"str_replace_editor",
			"apply_patch",
			"apply patch",
			"patch",
			"notebookedit",
			"notebook_edit"
		])
	) {
		return "edit"
	}
	if (
		nameIn(folded, [
			"bash",
			"shell",
			"exec",
			"execute",
			"run",
			"command",
			"kill",
			"killshell",
			"terminate"
		])
	) {
		return "execute"
	}
	if (nameIn(folded, ["grep", "search", "searchfiles", "ripgrep", "rg"])) {
		return "search"
	}
	if (
		nameIn(folded, [
			"glob",
			"ls",
			"list",
			"listfiles",
			"listdir",
			"find",
			"findfile",
			"find_files",
			"locate"
		])
	) {
		return "glob"
	}
	if (
		nameIn(folded, [
			"fetch",
			"http",
			"curl",
			"webfetch",
			"web_fetch",
			"http_fetch",
			"httpget"
		])
	) {
		return "fetch"
	}
	if (nameIn(folded, ["websearch", "web_search", "search_web", "googlesearch"])) {
		return "web_search"
	}
	if (nameIn(folded, ["todo", "todowrite", "todo_write", "todos", "tasklist"])) {
		return "todo"
	}
	if (
		nameIn(folded, [
			"ask",
			"askuser",
			"question",
			"askuserquestion",
			"ask_user_question"
		])
	) {
		return "question"
	}
	if (nameIn(folded, ["skill", "useskill", "use_skill"])) {
		return "skill"
	}
	if (nameIn(folded, ["planmode", "plan_mode", "enterplanmode", "enter_plan_mode"])) {
		return "enter_plan_mode"
	}
	if (nameIn(folded, ["exitplan", "exitplanmode", "exit_plan_mode", "execute_plan"])) {
		return "exit_plan_mode"
	}
	if (
		nameIn(folded, [
			"think",
			"reason",
			"task",
			"spawn",
			"agent",
			"subagent",
			"delegate",
			"spawntask"
		])
	) {
		return "task"
	}
	return "other"
}

const looksLikeSearchUrl = (url: string): boolean => Str.includes("/search?")(url)

export const resolveOpenCodeToolKind = (name: string, rawInput: JsonObject): OpenCodeToolKind => {
	const detected = detectOpenCodeToolKind(name)
	if (detected !== "fetch") {
		return detected
	}
	const url = stringField(rawInput, "url")
	if (Option.isSome(url) && looksLikeSearchUrl(url.value)) {
		return "web_search"
	}
	return detected
}

export const parseModelSelection = (modelId: string): Option.Option<OpenCodeModel> => {
	const trimmed = Str.trim(modelId)
	const slash = trimmed.indexOf("/")
	if (slash <= 0 || slash === trimmed.length - 1) {
		return Option.none()
	}
	const providerId = Str.trim(trimmed.slice(0, slash))
	const id = Str.trim(trimmed.slice(slash + 1))
	if (Str.isEmpty(providerId) || Str.isEmpty(id)) {
		return Option.none()
	}
	return Option.some({
		providerId,
		modelId: id
	})
}

export const canonicalModelId = (model: OpenCodeModel): string =>
	`${model.providerId}/${model.modelId}`

export const isSafeRequestId = (requestId: string): boolean => {
	if (Str.isEmpty(requestId)) {
		return false
	}
	return /^[A-Za-z0-9_-]+$/.test(requestId)
}

export const openCodeUrls = (baseUrl: string): OpenCodeUrls => {
	const trimmed = Str.replace(/\/$/, "")(baseUrl)
	return {
		baseUrl: trimmed,
		session: `${trimmed}/session`,
		config: `${trimmed}/config`,
		provider: `${trimmed}/provider`,
		command: `${trimmed}/command`,
		globalEvent: `${trimmed}/global/event`,
		promptAsync: (sessionId) => `${trimmed}/session/${sessionId}/prompt_async`,
		abort: (sessionId) => `${trimmed}/session/${sessionId}/abort`,
		permissionReply: (requestId) => `${trimmed}/permission/${requestId}/reply`,
		questionReply: (requestId) => `${trimmed}/question/${requestId}/reply`
	}
}

export const buildPromptBody = (input: {
	readonly directory: string
	readonly model: OpenCodeModel
	readonly agent: string
	readonly text: string
}): OpenCodePromptBody => ({
	directory: input.directory,
	model: {
		providerID: input.model.providerId,
		modelID: input.model.modelId
	},
	agent: input.agent,
	parts: [
		{
			type: "text",
			text: input.text
		}
	]
})

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

export const resolveConfiguredModel = (
	configuredModelId: string,
	availableModelIds: ReadonlyArray<string>
): Option.Option<string> => {
	if (Arr.contains(availableModelIds, configuredModelId)) {
		return Option.some(configuredModelId)
	}
	if (Str.includes("/")(configuredModelId)) {
		return Option.none()
	}
	const matches = Arr.filter(availableModelIds, (modelId) => {
		const slash = modelId.lastIndexOf("/")
		if (slash < 0) {
			return false
		}
		return modelId.slice(slash + 1) === configuredModelId
	})
	if (matches.length === 1) {
		return Arr.head(matches)
	}
	return Option.none()
}

export const consumeSseLine = (
	fold: SseLineFold,
	line: string
): {
	readonly fold: SseLineFold
	readonly raw: Option.Option<string>
} => {
	const trimmed = Str.replace(/\r$/, "")(line)
	if (Str.isEmpty(trimmed)) {
		if (fold.pending.length === 0) {
			return {
				fold: emptySseLineFold,
				raw: Option.none()
			}
		}
		return {
			fold: emptySseLineFold,
			raw: Option.some(Arr.join(fold.pending, "\n"))
		}
	}
	if (Str.startsWith("data:")(trimmed)) {
		return {
			fold: {
				pending: Arr.append(fold.pending, Str.trimStart(trimmed.slice(5)))
			},
			raw: Option.none()
		}
	}
	return {
		fold,
		raw: Option.none()
	}
}

export const encodeContractFact = (fact: OpenCodeContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<OpenCodeContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
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

const permissionRawInput = (permission: string, patterns: ReadonlyArray<string>): JsonObject => {
	const words = Arr.filter(Str.split(Str.trim(permission), " "), (part) => Str.isNonEmpty(part))
	const firstWord = Option.getOrElse(Arr.head(words), () => "")
	const kind = detectOpenCodeToolKind(firstWord)
	const tail =
		words.length < 2 ? Option.none<string>() : Option.some(Arr.join(Arr.drop(words, 1), " "))
	const firstPattern = Arr.head(patterns)
	const source = Option.orElse(firstPattern, () => tail)
	if (Option.isNone(source)) {
		return EMPTY_JSON_OBJECT
	}
	if (kind === "read" || kind === "edit") {
		return {
			file_path: source.value
		}
	}
	if (kind === "execute") {
		return {
			command: source.value
		}
	}
	if (kind === "search") {
		return {
			query: source.value
		}
	}
	if (kind === "glob") {
		return {
			pattern: source.value
		}
	}
	if (kind === "fetch" || kind === "web_search") {
		return {
			url: source.value
		}
	}
	return EMPTY_JSON_OBJECT
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

const usageFact = (
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

const toolCallUpdateFact = (
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
