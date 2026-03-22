import type { JsonValue, ToolArguments } from "../../services/converted-session-types.js";

export interface SkillCallInput {
	skill: string | null;
	args: string | null;
}

function isJsonObject(value: JsonValue | null | undefined): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(obj: { [key: string]: JsonValue }, keys: string[]): string | null {
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				return trimmed;
			}
		}
	}

	return null;
}

function readStringOrJson(obj: { [key: string]: JsonValue }, keys: string[]): string | null {
	for (const key of keys) {
		const value = obj[key];
		if (value === undefined || value === null) {
			continue;
		}

		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed.length > 0) {
				return trimmed;
			}
			continue;
		}

		const serialized = JSON.stringify(value).trim();
		if (serialized.length > 0 && serialized !== "null") {
			return serialized;
		}
	}

	return null;
}

export function extractSkillCallInput(args: ToolArguments | null | undefined): SkillCallInput {
	if (!args || args.kind !== "think") {
		return { skill: null, args: null };
	}

	const rawInput = isJsonObject(args.raw) ? args.raw : null;
	const rawSkill = rawInput ? readNonEmptyString(rawInput, ["skill_name", "skill", "name"]) : null;
	const rawArgs = rawInput ? readStringOrJson(rawInput, ["args", "skill_args", "skillArgs"]) : null;

	return {
		skill: rawSkill ?? args.skill ?? null,
		args: rawArgs ?? args.skill_args ?? null,
	};
}
