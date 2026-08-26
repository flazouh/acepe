import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Str from "effect/String"
import {
	field,
	isJsonArray,
	type JsonObject,
	jsonObjectOf,
	stringField,
	stringFieldAny
} from "../Json.ts"
import type { CodexAcpToolKind, CodexToolStatus } from "./Facts.ts"
import {
	COMMAND_APPROVAL_METHOD,
	FILE_CHANGE_APPROVAL_METHOD,
	FILE_READ_APPROVAL_METHOD
} from "./Wire.ts"

export const isToolItemType = (itemType: string): boolean =>
	itemType === "commandExecution" ||
	itemType === "fileRead" ||
	itemType === "fileChange" ||
	itemType === "fileSearch" ||
	itemType === "codeEdit"

const firstCommandAction = (item: JsonObject): Option.Option<string> => {
	const actions = field(item, "commandActions")
	if (Option.isNone(actions) || isJsonArray(actions.value) === false) {
		return Option.none()
	}
	const first = Arr.head(actions.value)
	return Option.flatMap(first, (entry) =>
		Option.flatMap(jsonObjectOf(entry), (action) => stringField(action, "command"))
	)
}

export const extractToolFields = (
	itemType: string,
	item: JsonObject
): { readonly name: string; readonly kind: CodexAcpToolKind; readonly title: string; readonly rawInput: JsonObject } => {
	if (itemType === "commandExecution") {
		const command = Option.getOrElse(firstCommandAction(item), () =>
			Option.getOrElse(stringField(item, "command"), () => "")
		)
		return {
			name: "Execute",
			kind: "execute",
			title: Str.isNonEmpty(command) ? command : "Execute",
			rawInput: { command }
		}
	}
	if (itemType === "fileRead") {
		const filePath = Option.getOrElse(stringFieldAny(item, ["filePath", "path"]), () => "")
		return {
			name: "Read",
			kind: "read",
			title: Str.isNonEmpty(filePath) ? `Read ${filePath}` : "Read",
			rawInput: { filePath }
		}
	}
	if (itemType === "fileChange") {
		const filePath = Option.getOrElse(stringFieldAny(item, ["filePath", "path"]), () => "")
		return {
			name: "Edit",
			kind: "edit",
			title: Str.isNonEmpty(filePath) ? `Edit ${filePath}` : "Edit",
			rawInput: { filePath }
		}
	}
	const label = Option.getOrElse(stringFieldAny(item, ["title", "name"]), () => itemType)
	return {
		name: itemType,
		kind: "other",
		title: label,
		rawInput: item
	}
}

export const toolStatusFromItem = (item: JsonObject, completed: boolean): CodexToolStatus => {
	const status = Option.getOrElse(stringField(item, "status"), () => "")
	if (status === "failed") {
		return "failed"
	}
	if (completed) {
		return "completed"
	}
	if (status === "completed") {
		return "completed"
	}
	return "in_progress"
}

export const permissionLabel = (method: string, params: JsonObject): string => {
	if (method === COMMAND_APPROVAL_METHOD) {
		return Option.getOrElse(stringField(params, "command"), () => "CommandExecution")
	}
	if (method === FILE_READ_APPROVAL_METHOD) {
		const path = stringFieldAny(params, ["filePath", "path"])
		return Option.match(path, {
			onNone: () => "Read",
			onSome: (value) => `Read ${value}`
		})
	}
	if (method === FILE_CHANGE_APPROVAL_METHOD) {
		const path = stringFieldAny(params, ["filePath", "path"])
		return Option.match(path, {
			onNone: () => "Edit",
			onSome: (value) => `Edit ${value}`
		})
	}
	return "Permission"
}
