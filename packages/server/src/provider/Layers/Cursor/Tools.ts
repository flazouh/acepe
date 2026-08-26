import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { CursorAcpToolKind } from "./Facts.ts"

const decodeToolKind = Schema.decodeUnknownExit(CursorAcpToolKind)

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

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
