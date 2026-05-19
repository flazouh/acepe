import type { ToolArguments } from "../../services/converted-session-types.js";

export interface SkillCallInput {
	skill: string | null;
	args: string | null;
}

export function extractSkillCallInput(args: ToolArguments | null | undefined): SkillCallInput {
	if (!args || args.kind !== "think") {
		return { skill: null, args: null };
	}

	return {
		skill: args.skill ?? null,
		args: args.skill_args ?? null,
	};
}
