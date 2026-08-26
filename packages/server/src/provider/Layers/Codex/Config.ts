import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Str from "effect/String"
import {
	CODEX_CONFIG_RELATIVE_PATH,
	type CodexNativeConfigState,
	defaultCodexNativeConfigState,
	normalizeCodexModelId,
	normalizeCodexReasoningEffort,
	parseCodexServiceTier
} from "./Provider.ts"

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
