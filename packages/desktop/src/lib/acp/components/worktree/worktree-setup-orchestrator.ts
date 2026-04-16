/**
 * Worktree setup orchestrator.
 *
 * Plain async function that coordinates: load config → run setup.
 * Called from agent-panel's send flow when a worktree has been created.
 */

import type { ResultAsync } from "neverthrow";

import { okAsync } from "neverthrow";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type { AppError } from "../../errors/app-error.js";

const TAG = "[worktree-setup]";

export interface WorktreeSetupResult {
	readonly cwd: string;
	readonly setupSuccess: boolean;
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
): ResultAsync<WorktreeSetupResult, AppError> {
	const { projectPath, worktreeCwd } = options;

	console.info(TAG, "starting", { projectPath, worktreeCwd });

	return tauriClient.git
		.loadWorktreeConfig(projectPath)
		.mapErr((error) => {
			console.error(TAG, "load-config failed", { projectPath, worktreeCwd, error });
			return error;
		})
		.andThen((config) => {
			const commands = config?.setupCommands ?? [];
			console.info(TAG, "config loaded", { commands, projectPath });
			if (commands.length === 0) {
				console.info(TAG, "no setup commands, skipping");
				return okAsync({ cwd: worktreeCwd, setupSuccess: true });
			}

			return executeSetup(worktreeCwd, projectPath);
		});
}

function executeSetup(
	worktreeCwd: string,
	projectPath: string
): ResultAsync<WorktreeSetupResult, AppError> {
	console.info(TAG, "executing setup commands", { worktreeCwd, projectPath });
	return tauriClient.git
		.runWorktreeSetup(worktreeCwd, projectPath)
		.map((result) => {
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
			return { cwd: worktreeCwd, setupSuccess: result.success };
		})
		.mapErr((error) => {
			console.error(TAG, "run-setup-invoke failed", { projectPath, worktreeCwd, error });
			return error;
		});
}
