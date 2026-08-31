import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { type JsonObject, stringFieldAny } from "../Json.ts"
import { GrokAcpToolKind } from "./Facts.ts"

const decodeToolKind = Schema.decodeUnknownExit(GrokAcpToolKind)

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(Str.trim(name)))

export const detectGrokToolKind = (name: string): GrokAcpToolKind => {
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
	if (folded === "switchmode") {
		return "switch_mode"
	}
	const decoded = decodeToolKind(name)
	if (Exit.isSuccess(decoded)) {
		return decoded.value
	}
	return "other"
}

// Field names an ACP tool call uses for its primary path-shaped input,
// checked in order. Grok sends "path"; the other two cost nothing and match
// what the sibling adapters already accept for the same kinds.
const PATH_INPUT_KEYS = ["path", "file_path", "filePath"] as const

// The path column of projection_session_activities, filled only for the kinds
// that are unambiguously about one file. Mirrors FILE_OPERATION_KINDS on the
// projector side, minus the kinds ACP never sends -- everything else keeps a
// null path and stays a plain tool row.
export const toolCallPathHint = (
	kind: GrokAcpToolKind,
	rawInput: JsonObject
): Option.Option<string> => {
	if (kind !== "read" && kind !== "edit" && kind !== "delete" && kind !== "move") {
		return Option.none()
	}
	return stringFieldAny(rawInput, PATH_INPUT_KEYS)
}
