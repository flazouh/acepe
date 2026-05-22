interface EmptyStateProjectLike {
	readonly path: string;
	readonly name: string;
}

export function resolveEmptyStateProject<TProject extends EmptyStateProjectLike>(input: {
	selectedProject: TProject | null;
	projects: readonly TProject[];
}): TProject | null {
	return input.selectedProject ?? input.projects[0] ?? null;
}

export function getEmptyStateProjectPath(
	project: EmptyStateProjectLike | null
): string | null {
	return project?.path ?? null;
}

export function getEmptyStateProjectName(
	project: EmptyStateProjectLike | null
): string | null {
	return project?.name ?? null;
}

export function shouldShowEmptyStateProjectPicker(projectCount: number): boolean {
	return projectCount > 1;
}

export function canShowEmptyStateInput(input: {
	projectCount: number;
	availableAgentCount: number;
}): boolean {
	return input.projectCount > 0 && input.availableAgentCount > 0;
}

export function isEmptyStateWorktreeEffectivelyPending(input: {
	worktreePending: boolean;
	activeWorktreePath: string | null;
}): boolean {
	return input.worktreePending && input.activeWorktreePath === null;
}
