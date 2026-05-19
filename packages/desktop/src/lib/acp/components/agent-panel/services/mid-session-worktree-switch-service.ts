/**
 * Mid-session worktree switch service (Continue-only path).
 *
 * Creates a prepared worktree session launch for an already-active session,
 * runs the worktree setup orchestration in the background, and returns the
 * prepared launch so the panel can rebind future sends to the new worktree.
 *
 * Existing changes in the source checkout are left untouched. Moving
 * session-owned changes is intentionally out of scope for this service.
 */

import { ResultAsync, errAsync, okAsync } from "neverthrow";
import { toast } from "svelte-sonner";

import { ValidationError, type AppError } from "$lib/acp/errors/app-error.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { PreparedWorktreeLaunch } from "../../../types/worktree-info.js";
import { createLogger } from "../../../utils/logger.js";
import { runWorktreeSetup } from "../../worktree/worktree-setup-orchestrator.js";

const logger = createLogger({
	id: "mid-session-worktree-switch-service",
	name: "MidSessionWorktreeSwitchService",
});

export interface MidSessionWorktreeSwitchResult {
	readonly preparedLaunch: PreparedWorktreeLaunch;
	readonly worktreePath: string;
}

/**
 * Prepare a new worktree for the current session and kick off setup.
 *
 * The returned `ResultAsync` resolves only after the Tauri prepare call
 * succeeds. Worktree setup commands run in the background; their failure is
 * surfaced via toast, not as a failed switch, matching first-send behavior.
 */
export function prepareMidSessionWorktreeSwitch(args: {
	projectPath: string;
	agentId: string;
}): ResultAsync<MidSessionWorktreeSwitchResult, AppError> {
	const { projectPath, agentId } = args;

	if (!projectPath) {
		return errAsync(
			new ValidationError("Cannot create a worktree without a project path.", "projectPath")
		);
	}
	if (!agentId) {
		return errAsync(
			new ValidationError("Cannot create a worktree without a selected agent.", "agentId")
		);
	}

	return tauriClient.git
		.prepareWorktreeSessionLaunch(projectPath, agentId)
		.andThen((preparedLaunch) => {
			void runWorktreeSetup({
				projectPath,
				worktreeCwd: preparedLaunch.worktree.directory,
			}).match(
				(result) => {
					if (!result.setupSuccess) toast.warning("Setup script failed");
				},
				(error) => {
					logger.warn("Worktree setup failed", { error });
					toast.warning("Setup script failed");
				}
			);

			return okAsync({
				preparedLaunch,
				worktreePath: preparedLaunch.worktree.directory,
			});
		});
}
