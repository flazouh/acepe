import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import { type JsonObject, stringFieldAny } from "../Json.ts"
import { type ClaudeAcpToolKind } from "./Facts.ts"

const normalizeToolName = (name: string): string => {
	const trimmed = Str.trim(name)
	if (Str.startsWith("mcp__")(trimmed)) {
		return Option.getOrElse(Arr.last(Str.split(trimmed, "__")), () => trimmed)
	}
	return trimmed
}

export const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(normalizeToolName(name)))

export const detectClaudeToolKind = (name: string): ClaudeAcpToolKind => {
	const folded = foldedName(name)
	if (folded === "read" || folded === "readfile" || folded === "view" || folded === "notebookread") {
		return "read"
	}
	if (folded === "readlints") {
		return "read_lints"
	}
	if (
		folded === "bash" ||
		folded === "execute" ||
		folded === "shell" ||
		folded === "run" ||
		folded === "terminal" ||
		folded === "killshell" ||
		folded === "killbash"
	) {
		return "execute"
	}
	if (
		folded === "edit" ||
		folded === "editfile" ||
		folded === "write" ||
		folded === "writefile" ||
		folded === "multiedit" ||
		folded === "strreplace" ||
		folded === "strreplaceeditor" ||
		folded === "applypatch"
	) {
		return "edit"
	}
	if (folded === "glob" || folded === "ls") {
		return "glob"
	}
	if (folded === "grep" || folded === "search") {
		return "search"
	}
	if (folded === "webfetch" || folded === "fetch") {
		return "fetch"
	}
	if (folded === "websearch") {
		return "web_search"
	}
	if (folded === "think") {
		return "think"
	}
	if (folded === "todowrite" || folded === "todoread" || folded === "todo") {
		return "todo"
	}
	if (folded === "askuserquestion" || folded === "askuser" || folded === "question") {
		return "question"
	}
	if (folded === "task" || folded === "taskcreate" || folded === "taskupdate") {
		return "task"
	}
	if (folded === "skill") {
		return "skill"
	}
	if (folded === "enterplanmode") {
		return "enter_plan_mode"
	}
	if (folded === "exitplanmode") {
		return "exit_plan_mode"
	}
	return "other"
}

// Field names the various Claude tools use for their primary path-shaped
// input, checked in order. Mirrors the "filePath"/"file_path" duality
// Codex/Map.ts's extractToolFields already relies on for the same
// read/edit kinds -- Claude's own tool schemas use snake_case exclusively,
// but staying permissive costs nothing.
const PATH_INPUT_KEYS = ["file_path", "path", "notebook_path"] as const

// A short, tool-specific hint pulled from the tool's own input, used to turn
// a bare tool name ("Read") into a title that actually says what happened
// ("Read package.json") -- see toolCallTitle below. Deliberately narrow: only
// the kinds where a single input field is obviously "the point" of the call
// get a hint, everything else (todo, question, task, skill, ...) keeps its
// bare name rather than guessing at a misleading one.
const toolCallPrimaryInputHint = (
	kind: ClaudeAcpToolKind,
	rawInput: JsonObject
): Option.Option<string> => {
	if (kind === "read" || kind === "read_lints" || kind === "edit") {
		return stringFieldAny(rawInput, PATH_INPUT_KEYS)
	}
	if (kind === "execute") {
		return stringFieldAny(rawInput, ["command"])
	}
	if (kind === "search") {
		return stringFieldAny(rawInput, ["pattern", "query"])
	}
	if (kind === "glob") {
		return stringFieldAny(rawInput, ["pattern"])
	}
	if (kind === "fetch" || kind === "web_search") {
		return stringFieldAny(rawInput, ["url", "query"])
	}
	return Option.none()
}

// Mirrors Codex/Map.ts's extractToolFields titling convention (e.g.
// "Read /tmp/example.rs", or the bare command for execute with no tool-name
// prefix) so the same session activity row reads consistently regardless of
// which provider produced it. Falls back to the bare tool name when no hint
// is available -- e.g. content_block_start firing before the real (still
// streaming) input has arrived.
export const toolCallTitle = (name: string, kind: ClaudeAcpToolKind, rawInput: JsonObject): string => {
	const hint = toolCallPrimaryInputHint(kind, rawInput)
	if (Option.isNone(hint)) {
		return name
	}
	if (kind === "execute") {
		return hint.value
	}
	return `${name} ${hint.value}`
}

// The path column of projection_session_activities -- populated only for the
// kinds that are unambiguously about a single file (read/edit), matching
// FILE_OPERATION_KINDS' intent on the projector side.
export const toolCallPathHint = (kind: ClaudeAcpToolKind, rawInput: JsonObject): Option.Option<string> => {
	if (kind !== "read" && kind !== "edit") {
		return Option.none()
	}
	return stringFieldAny(rawInput, PATH_INPUT_KEYS)
}

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

export const permissionNameForToolKind = (kind: ClaudeAcpToolKind): string => {
	if (kind === "execute") {
		return "execute"
	}
	if (kind === "edit") {
		return "edit"
	}
	if (kind === "read" || kind === "read_lints") {
		return "read"
	}
	return kind
}
