import type { AgentToolStatus } from "./types.js";

export const SKILL_ARGS_PREVIEW_LIMIT = 40;

export function isSkillPending(status: AgentToolStatus): boolean {
	return status === "pending" || status === "running";
}

export function isSkillSuccess(status: AgentToolStatus): boolean {
	return status === "done";
}

export function hasSkillDescription(description?: string | null): boolean {
	return Boolean(description && description.trim().length > 0);
}

export function getSkillDisplayName(skillName?: string | null): string | null {
	return skillName ? `/${skillName}` : null;
}

export function getSkillDisplayArgs(skillArgs?: string | null): string | null | undefined {
	if (!skillArgs) return skillArgs;
	return skillArgs.length > SKILL_ARGS_PREVIEW_LIMIT
		? `${skillArgs.slice(0, SKILL_ARGS_PREVIEW_LIMIT)}...`
		: skillArgs;
}

export function getSkillViewState(input: {
	status: AgentToolStatus;
	skillName?: string | null;
	description?: string | null;
}): {
	isPending: boolean;
	isSuccess: boolean;
	hasDescription: boolean;
	hasContent: boolean;
	showLoadingFallback: boolean;
	showMissingNameFallback: boolean;
} {
	const isPending = isSkillPending(input.status);
	const hasDescription = hasSkillDescription(input.description);
	const hasSkillName = Boolean(input.skillName);

	return {
		isPending,
		isSuccess: isSkillSuccess(input.status),
		hasDescription,
		hasContent: hasDescription,
		showLoadingFallback: isPending && !hasSkillName,
		showMissingNameFallback: !isPending && !hasSkillName,
	};
}
