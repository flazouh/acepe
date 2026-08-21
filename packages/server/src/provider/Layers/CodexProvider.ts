import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { relativeCmd } from "../agentJson.ts"
import {
	isCapabilityEnabled,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../Services/ProviderAdapter.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
const EMPTY_JSON_OBJECT: JsonObject = {}

export const CODEX_PROVIDER_ID: ProviderId = ProviderId.make("codex")

export const CODEX_DEFERRED_SESSION_CREATION = false

export const CODEX_APP_SERVER_ARGS = ["app-server"] as const

export const CODEX_PLACEHOLDER_COMMAND = "codex"

export const CODEX_REQUEST_TIMEOUT_SECONDS = 30

export const CODEX_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: [
		"models",
		"modes",
		"configOptions",
		"plan",
		"usage",
		"toolCalls",
		"permissionRequests"
	]
})

export const CODEX_MODES = ["agent", "plan"] as const
export type CodexMode = (typeof CODEX_MODES)[number]

export const CODEX_MODELS = [
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.2-codex",
	"gpt-5.2"
] as const
export type CodexModel = (typeof CODEX_MODELS)[number]

export const CODEX_REASONING_EFFORTS = ["xhigh", "high", "medium", "low", "minimal"] as const
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

export const DEFAULT_CODEX_MODEL_ID: CodexModel = "gpt-5.3-codex"
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "high"

export const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS =
	"# Plan Mode\n\nProduce a decision-complete implementation plan before execution."
export const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS =
	"# Default Mode\n\nMake reasonable assumptions and execute the user's request."

export const CODEX_AUTH_RELATIVE_PATH = ".codex/auth.json"
export const CODEX_CONFIG_RELATIVE_PATH = ".codex/config.toml"

const THREAD_NOT_FOUND_SNIPPET = "thread not found"
const THREAD_RESUME_TIMEOUT_SNIPPET = "timed out waiting for server"

const CodexCacheMeta = Schema.Struct({
	cmd: Schema.String
})
const decodeCacheMeta = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexCacheMeta))

export type CodexNativeConfigState = {
	readonly currentModelId: string
	readonly reasoningEffort: string
	readonly fastMode: boolean
}

export const defaultCodexNativeConfigState = (): CodexNativeConfigState => ({
	currentModelId: DEFAULT_CODEX_MODEL_ID,
	reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
	fastMode: false
})

export type CodexSpawnConfig = {
	readonly command: string
	readonly args: ReadonlyArray<string>
}

export const placeholderCodexSpawnConfig = (): CodexSpawnConfig => ({
	command: CODEX_PLACEHOLDER_COMMAND,
	args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
})

export const codexPresence = (installed: boolean, authenticated: boolean): ProviderPresence => ({
	providerId: CODEX_PROVIDER_ID,
	installed,
	authenticated
})

export const isCodexPlanCapabilityEnabled = (): boolean =>
	isCapabilityEnabled(CODEX_CAPABILITIES, "plan")

export const normalizeCodexModelId = (modelId: string): string => {
	const trimmed = Str.trim(modelId)
	if (Str.isNonEmpty(trimmed)) {
		return trimmed
	}
	return DEFAULT_CODEX_MODEL_ID
}

export const normalizeCodexReasoningEffort = (value: string): Option.Option<CodexReasoningEffort> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "xhigh") {
		return Option.some("xhigh")
	}
	if (normalized === "high") {
		return Option.some("high")
	}
	if (normalized === "medium") {
		return Option.some("medium")
	}
	if (normalized === "low") {
		return Option.some("low")
	}
	if (normalized === "minimal") {
		return Option.some("minimal")
	}
	return Option.none()
}

export const parseCodexServiceTier = (value: string): Option.Option<boolean> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "fast") {
		return Option.some(true)
	}
	if (normalized === "flex" || normalized === "default") {
		return Option.some(false)
	}
	return Option.none()
}

export const parseCodexFastModeValue = (value: string): Option.Option<boolean> => {
	const normalized = Str.toLowerCase(Str.trim(value))
	if (normalized === "true" || normalized === "on" || normalized === "enabled" || normalized === "1") {
		return Option.some(true)
	}
	if (
		normalized === "false" ||
		normalized === "off" ||
		normalized === "disabled" ||
		normalized === "0"
	) {
		return Option.some(false)
	}
	return Option.none()
}

export const resolveCodexModeId = (modeId: string): Option.Option<CodexMode> => {
	if (modeId === "plan") {
		return Option.some("plan")
	}
	if (modeId === "agent" || modeId === "build" || modeId === "default") {
		return Option.some("agent")
	}
	return Option.none()
}

const quotedTomlAssignment = (
	line: string
): Option.Option<{ readonly key: string; readonly value: string }> => {
	const trimmed = Str.trim(line)
	if (Str.startsWith("#")(trimmed) || Str.isEmpty(trimmed)) {
		return Option.none()
	}
	const eq = trimmed.indexOf("=")
	if (eq <= 0) {
		return Option.none()
	}
	const key = Str.trim(trimmed.slice(0, eq))
	const raw = Str.trim(trimmed.slice(eq + 1))
	if (Str.startsWith("\"")(raw) === false || Str.endsWith("\"")(raw) === false || raw.length < 2) {
		return Option.none()
	}
	return Option.some({
		key,
		value: raw.slice(1, raw.length - 1)
	})
}

export type CodexTomlPatch = {
	readonly currentModelId: Option.Option<string>
	readonly reasoningEffort: Option.Option<string>
	readonly fastMode: Option.Option<boolean>
}

const emptyTomlPatch = (): CodexTomlPatch => ({
	currentModelId: Option.none(),
	reasoningEffort: Option.none(),
	fastMode: Option.none()
})

export const parseCodexToml = (raw: string): CodexTomlPatch =>
	Arr.reduce(Str.split(raw, "\n"), emptyTomlPatch(), (state, line) =>
		Option.match(quotedTomlAssignment(line), {
			onNone: () => state,
			onSome: (assignment) => {
				if (assignment.key === "model") {
					return {
						currentModelId: Option.some(normalizeCodexModelId(assignment.value)),
						reasoningEffort: state.reasoningEffort,
						fastMode: state.fastMode
					}
				}
				if (assignment.key === "model_reasoning_effort") {
					return {
						currentModelId: state.currentModelId,
						reasoningEffort: normalizeCodexReasoningEffort(assignment.value),
						fastMode: state.fastMode
					}
				}
				if (assignment.key === "service_tier") {
					return {
						currentModelId: state.currentModelId,
						reasoningEffort: state.reasoningEffort,
						fastMode: parseCodexServiceTier(assignment.value)
					}
				}
				return state
			}
		})
	)

const applyCodexTomlPatch = (
	base: CodexNativeConfigState,
	patch: CodexTomlPatch
): CodexNativeConfigState => ({
	currentModelId: Option.getOrElse(patch.currentModelId, () => base.currentModelId),
	reasoningEffort: Option.getOrElse(patch.reasoningEffort, () => base.reasoningEffort),
	fastMode: Option.getOrElse(patch.fastMode, () => base.fastMode)
})

const readCodexTomlPatch = Effect.fn("readCodexTomlPatch")(function*(filePath: string) {
	const fs = yield* FileSystem.FileSystem
	const exists = yield* fs.exists(filePath)
	if (exists === false) {
		return emptyTomlPatch()
	}
	const text = yield* fs.readFileString(filePath)
	return parseCodexToml(text)
})

export const loadCodexNativeConfigState = Effect.fn("loadCodexNativeConfigState")(function*(
	workspaceRoot: string
) {
	const path = yield* Path.Path
	const home = yield* Config.option(Config.string("HOME"))
	const globalPath = Option.map(home, (homeDir) => path.join(homeDir, CODEX_CONFIG_RELATIVE_PATH))
	const projectPath = path.join(workspaceRoot, CODEX_CONFIG_RELATIVE_PATH)
	const globalPatch = yield* Option.match(globalPath, {
		onNone: () => Effect.succeed(emptyTomlPatch()),
		onSome: (filePath) => readCodexTomlPatch(filePath)
	})
	const projectPatch = yield* readCodexTomlPatch(projectPath)
	return applyCodexTomlPatch(
		applyCodexTomlPatch(defaultCodexNativeConfigState(), globalPatch),
		projectPatch
	)
})

export const cachedCodexBinaryPath = Effect.fn("cachedCodexBinaryPath")(function*(cacheDir: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const agentDir = path.join(cacheDir, "codex")
	const metaPath = path.join(agentDir, "meta.json")
	const metaExists = yield* fs.exists(metaPath)
	if (metaExists === false) {
		return Option.none<string>()
	}
	const text = yield* fs.readFileString(metaPath)
	const meta = yield* Effect.option(decodeCacheMeta(text))
	if (Option.isNone(meta)) {
		return Option.none<string>()
	}
	const binaryPath = path.join(agentDir, relativeCmd(meta.value.cmd))
	const binaryExists = yield* fs.exists(binaryPath)
	if (binaryExists === false) {
		return Option.none<string>()
	}
	return Option.some(binaryPath)
})

export const resolveCodexSpawnConfig = Effect.fn("resolveCodexSpawnConfig")(function*(
	cacheDir: Option.Option<string>
) {
	const cached = yield* Option.match(cacheDir, {
		onNone: () => Effect.succeed(Option.none<string>()),
		onSome: (dir) => cachedCodexBinaryPath(dir)
	})
	return Option.match(cached, {
		onNone: placeholderCodexSpawnConfig,
		onSome: (command) => ({
			command,
			args: Arr.fromIterable(CODEX_APP_SERVER_ARGS)
		})
	})
})

export const probeCodexPresence = Effect.fn("probeCodexPresence")(function*(
	cacheDir: Option.Option<string>
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const home = yield* Config.option(Config.string("HOME"))
	const spawn = yield* resolveCodexSpawnConfig(cacheDir)
	const installed = spawn.command !== CODEX_PLACEHOLDER_COMMAND
	const authPath = Option.map(home, (homeDir) => path.join(homeDir, CODEX_AUTH_RELATIVE_PATH))
	const authenticated = yield* Option.match(authPath, {
		onNone: () => Effect.succeed(false),
		onSome: (filePath) => fs.exists(filePath)
	})
	return codexPresence(installed, authenticated)
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

export const isRecoverableThreadResumeError = (detail: string): boolean => {
	const lowered = Str.toLowerCase(detail)
	if (Str.includes("session not found")(lowered)) {
		return true
	}
	if (Str.includes("thread/resume")(lowered) === false) {
		return false
	}
	return (
		Str.includes(THREAD_NOT_FOUND_SNIPPET)(lowered) ||
		Str.includes(THREAD_RESUME_TIMEOUT_SNIPPET)(lowered)
	)
}

export type CodexPermissionDecision = "accept" | "acceptForSession" | "decline"

export const mapCodexPermissionReply = (reply: string): Option.Option<CodexPermissionDecision> => {
	if (reply === "once" || reply === "allow") {
		return Option.some("accept")
	}
	if (reply === "always") {
		return Option.some("acceptForSession")
	}
	if (reply === "reject" || reply === "deny") {
		return Option.some("decline")
	}
	return Option.none()
}

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
