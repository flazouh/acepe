interface ResolveWorktreeToggleProjectPathInput {
	readonly hasSession: boolean;
	readonly sessionProjectPath: string | null;
	readonly selectedProjectPath: string | null;
	readonly singleProjectPath: string | null;
}

export function resolveWorktreeToggleProjectPath(
	input: ResolveWorktreeToggleProjectPathInput
): string | null {
	if (input.sessionProjectPath) {
		return input.sessionProjectPath;
	}

	return input.selectedProjectPath ?? input.singleProjectPath;
}
