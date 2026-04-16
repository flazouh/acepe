import type {
	JsonValue,
	ToolArguments,
	ToolCallData,
	ToolKind,
} from "../../services/converted-session-types.js";

type JsonObject = Record<string, JsonValue>;

export type ReclassifiedToolCall = {
	name: string;
	kind: ToolKind;
	arguments: ToolArguments;
};

function isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: JsonObject, keys: readonly string[]): string | null {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate !== "string") {
			continue;
		}

		const trimmed = candidate.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}

	return null;
}

function hasFlagLikeKeys(value: JsonObject): boolean {
	return Object.keys(value).some((key) => key.startsWith("-"));
}

function looksLikeGlobPattern(pattern: string): boolean {
	return (
		pattern.includes("*") ||
		pattern.includes("?") ||
		pattern.includes("[") ||
		pattern.includes("{")
	);
}

function canonicalToolName(name: string): string {
	switch (name) {
		case "Bash":
		case "Execute":
			return "Run";
		case "Glob":
			return "Find";
		case "Grep":
			return "Search";
		case "WebSearch":
			return "Web Search";
		case "TaskOutput":
			return "Task Output";
		case "EnterPlanMode":
		case "ExitPlanMode":
			return "Plan";
		case "CreatePlan":
			return "Create Plan";
		case "read_file":
		case "ReadFile":
			return "Read";
		case "edit_file":
		case "EditFile":
		case "apply_patch":
			return "Edit";
		default:
			return name;
	}
}

export function reclassifyGenericToolCall(
	data: Pick<ToolCallData, "name" | "kind" | "arguments" | "rawInput">
): ReclassifiedToolCall | null {
	const isGenericRead =
		canonicalToolName(data.name) === "Read" &&
		(data.kind === "read" || data.arguments.kind === "read");
	if (!isGenericRead || !isJsonObject(data.rawInput)) {
		return null;
	}

	const rawInput = data.rawInput;
	const filePath = readString(rawInput, ["path", "file_path", "filePath"]);
	const pattern = readString(rawInput, ["pattern", "query"]);
	const oldString = readString(rawInput, ["old_string", "oldString", "oldText", "old_str"]);
	const newString = readString(rawInput, ["new_string", "newString", "newText", "new_str"]);
	const content = readString(rawInput, ["content"]);
	const explicitGlobPattern = readString(rawInput, ["glob_pattern", "globPattern"]);
	const ripgrepShape =
		"glob" in rawInput || "output_mode" in rawInput || hasFlagLikeKeys(rawInput);

	if (oldString !== null || newString !== null || content !== null) {
		return {
			name: "Edit",
			kind: "edit",
			arguments: {
				kind: "edit",
				edits: [
					{
						filePath,
						moveFrom: null,
						oldString,
						newString,
						content,
					},
				],
			},
		};
	}

	if (
		explicitGlobPattern !== null ||
		(filePath !== null && pattern !== null && looksLikeGlobPattern(pattern) && !ripgrepShape)
	) {
		return {
			name: "Find",
			kind: "glob",
			arguments: {
				kind: "glob",
				pattern: explicitGlobPattern ?? pattern,
				path: filePath,
			},
		};
	}

	if (pattern !== null) {
		return {
			name: "Search",
			kind: "search",
			arguments: {
				kind: "search",
				query: pattern,
				file_path: filePath,
			},
		};
	}

	return null;
}
