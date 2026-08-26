import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { CopilotAcpToolKind, type PermissionRequestFact } from "./Facts.ts"

const decodeToolKind = Schema.decodeUnknownExit(CopilotAcpToolKind)

const normalizeToolName = (name: string): string => {
	const trimmed = Str.trim(name)
	if (Str.startsWith("mcp__")(trimmed)) {
		return Option.getOrElse(Arr.last(Str.split(trimmed, "__")), () => trimmed)
	}
	return trimmed
}

const foldedName = (name: string): string =>
	Str.toLowerCase(Str.replaceAll(/[\s_-]/g, "")(normalizeToolName(name)))

const COPILOT_TOOL_KIND_BY_FOLDED = HashMap.fromIterable([
	["read", "read"],
	["readfile", "read"],
	["view", "read"],
	["notebookread", "read"],
	["readlints", "read_lints"],
	["edit", "edit"],
	["editfile", "edit"],
	["write", "edit"],
	["writefile", "edit"],
	["strreplace", "edit"],
	["strreplaceeditor", "edit"],
	["applypatch", "edit"],
	["bash", "execute"],
	["execute", "execute"],
	["shell", "execute"],
	["run", "execute"],
	["terminal", "execute"],
	["killshell", "execute"],
	["killbash", "execute"],
	["glob", "glob"],
	["ls", "glob"],
	["find", "glob"],
	["grep", "search"],
	["rg", "search"],
	["ripgrep", "search"],
	["search", "search"],
	["webfetch", "fetch"],
	["fetch", "fetch"],
	["http", "fetch"],
	["websearch", "web_search"],
	["web", "web_search"],
	["think", "think"],
	["todowrite", "todo"],
	["todoread", "todo"],
	["todo", "todo"],
	["updatetodos", "todo"],
	["marktodo", "todo"],
	["tasklist", "todo"],
	["todos", "todo"],
	["askuserquestion", "question"],
	["askuser", "question"],
	["question", "question"],
	["task", "task"],
	["spawn", "task"],
	["agent", "task"],
	["subagent", "task"],
	["taskcreate", "task"],
	["taskupdate", "task"],
	["skill", "skill"],
	["enterplanmode", "enter_plan_mode"],
	["exitplanmode", "exit_plan_mode"],
	["createplan", "exit_plan_mode"]
] satisfies ReadonlyArray<readonly [string, CopilotAcpToolKind]>)

export const detectCopilotToolKind = (name: string): CopilotAcpToolKind =>
	Option.getOrElse(HashMap.get(COPILOT_TOOL_KIND_BY_FOLDED, foldedName(name)), () => "other")

export const asToolKind = (value: string): CopilotAcpToolKind => {
	const decoded = decodeToolKind(value)
	if (Exit.isSuccess(decoded)) {
		return decoded.value
	}
	return detectCopilotToolKind(value)
}

export const permissionIdForToolCall = (toolCallId: string): string => `perm-${toolCallId}`

export const permissionNameForToolKind = (kind: CopilotAcpToolKind): string => {
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

export const permissionRequestFact = (input: {
	readonly sessionId: string
	readonly toolCallId: string
	readonly toolName: string
}): PermissionRequestFact => ({
	contractKind: "permission_request",
	id: permissionIdForToolCall(input.toolCallId),
	sessionId: input.sessionId,
	permission: permissionNameForToolKind(detectCopilotToolKind(input.toolName)),
	toolCallId: input.toolCallId
})
