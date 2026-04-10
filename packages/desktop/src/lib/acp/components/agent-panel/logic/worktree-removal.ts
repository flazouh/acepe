import { okAsync, type ResultAsync } from "neverthrow";

export interface RemoveWorktreeAndMarkSessionWorktreeDeletedOptions {
	readonly force: boolean;
	readonly sessionId: string | null;
	readonly worktreePath: string | null;
}

export interface RemoveWorktreeAndMarkSessionWorktreeDeletedDependencies<ErrorType> {
	readonly removeWorktree: (worktreePath: string, force: boolean) => ResultAsync<void, ErrorType>;
	readonly markSessionWorktreeDeleted: (sessionId: string) => void;
	readonly clearSessionWorktreeDeleted: (sessionId: string) => void;
	readonly disconnectSession: (sessionId: string) => void;
}

export function removeWorktreeAndMarkSessionWorktreeDeleted<ErrorType>(
	options: RemoveWorktreeAndMarkSessionWorktreeDeletedOptions,
	dependencies: RemoveWorktreeAndMarkSessionWorktreeDeletedDependencies<ErrorType>
): ResultAsync<void, ErrorType> {
	const { force, sessionId, worktreePath } = options;
	if (!worktreePath) {
		return okAsync(undefined);
	}

	if (!sessionId) {
		return dependencies.removeWorktree(worktreePath, force);
	}

	dependencies.markSessionWorktreeDeleted(sessionId);

	return dependencies
		.removeWorktree(worktreePath, force)
		.andThen(() => {
			dependencies.disconnectSession(sessionId);
			return okAsync(undefined);
		})
		.mapErr((error) => {
			dependencies.clearSessionWorktreeDeleted(sessionId);
			return error;
		});
}
