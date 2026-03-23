/**
 * Worktree setup orchestrator.
 *
 * Plain async function that coordinates: load config → run setup.
 * Called from agent-panel's send flow when a worktree has been created.
 */

import type { ResultAsync } from "neverthrow";

import { okAsync } from "neverthrow";
import { captureError } from "$lib/analytics.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type { AppError } from "../../errors/app-error.js";
import { WorktreeError } from "../../errors/app-error.js";

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
			captureError(toError("load-config", error, { projectPath, worktreeCwd }));
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
				captureError(
					toError("run-setup-commands", new WorktreeError(result.error ?? "unknown"), {
						projectPath,
						worktreeCwd,
						commandsRun: result.commandsRun,
					})
				);
			} else {
				console.info(TAG, "setup commands succeeded", {
					commandsRun: result.commandsRun,
				});
			}
			return { cwd: worktreeCwd, setupSuccess: result.success };
		})
		.mapErr((error) => {
			console.error(TAG, "run-setup-invoke failed", { projectPath, worktreeCwd, error });
			captureError(toError("run-setup-invoke", error, { projectPath, worktreeCwd }));
			return error;
		});
}

/** Build an Error with structured context for Sentry. */
function toError(
	step: string,
	source: AppError | Error,
	context: Record<string, unknown>
): Error {
	const msg = `Worktree setup failed [${step}]: ${source.message}`;
	const err = new Error(msg, { cause: source });
	Object.assign(err, { worktreeSetupContext: { step, ...context } });
	return err;
}
