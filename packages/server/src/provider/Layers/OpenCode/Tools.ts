import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import { EMPTY_JSON_OBJECT, type JsonObject, stringField } from "../Json.ts"
import type { OpenCodeToolKind } from "./Facts.ts"

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

export const permissionRawInput = (
	permission: string,
	patterns: ReadonlyArray<string>
): JsonObject => {
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
