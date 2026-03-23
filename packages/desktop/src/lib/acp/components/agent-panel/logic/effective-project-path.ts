export interface EffectiveProjectPathInput {
	readonly activeWorktreePath: string | null;
	readonly sessionWorktreePath: string | null;
	readonly sessionProjectPath: string | null;
	readonly selectedProjectPath: string | undefined;
	readonly singleProjectPath: string | undefined;
}

export function resolveEffectiveProjectPath(input: EffectiveProjectPathInput): string | undefined {
	return (
		input.activeWorktreePath ??
		input.sessionWorktreePath ??
		input.sessionProjectPath ??
		input.selectedProjectPath ??
		input.singleProjectPath
	);
}
