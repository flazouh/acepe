import * as Effect from "effect/Effect";

export interface RemoveWorktreeAndMarkSessionWorktreeDeletedOptions {
	readonly force: boolean;
	readonly sessionId: string | null;
	readonly worktreePath: string | null;
}

export interface RemoveWorktreeAndMarkSessionWorktreeDeletedDependencies<ErrorType> {
	readonly removeWorktree: (
		worktreePath: string,
		force: boolean
	) => Effect.Effect<void, ErrorType>;
	readonly markSessionWorktreeDeleted: (sessionId: string) => void;
	readonly clearSessionWorktreeDeleted: (sessionId: string) => void;
	readonly disconnectSession: (sessionId: string) => void;
}

export function removeWorktreeAndMarkSessionWorktreeDeleted<ErrorType>(
	options: RemoveWorktreeAndMarkSessionWorktreeDeletedOptions,
	dependencies: RemoveWorktreeAndMarkSessionWorktreeDeletedDependencies<ErrorType>
): Effect.Effect<void, ErrorType> {
	const { force, sessionId, worktreePath } = options;
	if (!worktreePath) {
		return Effect.succeed(undefined);
	}

	if (!sessionId) {
		return dependencies.removeWorktree(worktreePath, force);
	}

	dependencies.markSessionWorktreeDeleted(sessionId);

	return dependencies.removeWorktree(worktreePath, force).pipe(
		Effect.flatMap(() => {
			dependencies.disconnectSession(sessionId);
			return Effect.succeed(undefined);
		}),
		Effect.mapError((error) => {
			dependencies.clearSessionWorktreeDeleted(sessionId);
			return error;
		})
	);
}
