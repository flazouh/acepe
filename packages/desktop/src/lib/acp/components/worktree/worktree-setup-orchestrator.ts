/**
 * Worktree setup orchestrator.
 *
 * Plain async function that coordinates: load config → run setup.
 * Called from agent-panel's send flow when a worktree has been created.
 */

import * as Effect from "effect/Effect";
import { backendClient } from "$lib/utils/backend-client.js";

import type { AppError } from "../../errors/app-error.js";
import type { CommandOutput } from "../../types/worktree-config.js";

const TAG = "[worktree-setup]";

export interface WorktreeSetupResult {
	readonly cwd: string;
	readonly setupSuccess: boolean;
	/**
	 * What each configured setup command printed, in the order the server ran
	 * them. Empty when the project configures no setup commands.
	 */
	readonly commands: readonly CommandOutput[];
	/** The server's reason for the failure, or null when the run succeeded. */
	readonly error: string | null;
}

export interface WorktreeSetupOptions {
	readonly projectPath: string;
	readonly worktreeCwd: string;
}

/**
 * Run worktree setup after worktree creation.
 *
 * 1. Load .acepe.json config from project root
 * 2. If setup commands exist, run them via Rust
 * 3. Return result
 */
export function runWorktreeSetup(
	options: WorktreeSetupOptions
): Effect.Effect<WorktreeSetupResult, AppError> {
	const { projectPath, worktreeCwd } = options;

	console.info(TAG, "starting", { projectPath, worktreeCwd });

	return backendClient.git.loadWorktreeConfig(projectPath).pipe(
		Effect.mapError((error) => {
			console.error(TAG, "load-config failed", { projectPath, worktreeCwd, error });
			return error;
		}),
		Effect.flatMap((config) => {
			const commands = config?.setupCommands ?? [];
			console.info(TAG, "config loaded", { commands, projectPath });
			if (commands.length === 0) {
				console.info(TAG, "no setup commands, skipping");
				return Effect.succeed({
					cwd: worktreeCwd,
					setupSuccess: true,
					commands: [],
					error: null,
				});
			}

			return executeSetup(worktreeCwd, projectPath);
		})
	);
}

function executeSetup(
	worktreeCwd: string,
	projectPath: string
): Effect.Effect<WorktreeSetupResult, AppError> {
	console.info(TAG, "executing setup commands", { worktreeCwd, projectPath });
	return backendClient.git.runWorktreeSetup(worktreeCwd, projectPath).pipe(
		Effect.map((result) => {
			if (!result.success) {
				console.error(TAG, "setup commands failed", {
					error: result.error,
					commandsRun: result.commandsRun,
				});
			} else {
				console.info(TAG, "setup commands succeeded", {
					commandsRun: result.commandsRun,
				});
			}
			return {
				cwd: worktreeCwd,
				setupSuccess: result.success,
				commands: result.output,
				error: result.error,
			};
		}),
		Effect.mapError((error) => {
			console.error(TAG, "run-setup-invoke failed", { projectPath, worktreeCwd, error });
			return error;
		})
	);
}
