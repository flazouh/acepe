/**
 * First-send worktree path preparation: Tauri prepare + background setup orchestration.
 */

import { toast } from "svelte-sonner";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { PreparedWorktreeLaunch } from "../../../types/worktree-info.js";
import { createLogger } from "../../../utils/logger.js";
import { runWorktreeSetup } from "../../worktree/worktree-setup-orchestrator.js";

const logger = createLogger({
	id: "agent-input-worktree-send-workflow",
	name: "AgentInputWorktreeSendWorkflow",
});

export type WorktreePrepForSendResult =
	| {
			ok: true;
			worktreePath: string;
			preparedLaunch: PreparedWorktreeLaunch;
	  }
	| { ok: false; error: Error };

/**
 * Ensures a worktree directory exists when the user enabled the worktree toggle before first send.
 * Reuses an existing prepared launch when present; otherwise calls Tauri and runs setup in the background.
 */
export async function prepareWorktreePathForPendingSend(args: {
	projectPath: string;
	selectedAgentId: string;
	existingPrepared: PreparedWorktreeLaunch | null;
	/** Invoked immediately before the Tauri prepare call (panel pending UX + product hooks). */
	notifyCreating: () => void;
}): Promise<WorktreePrepForSendResult> {
	const { projectPath, selectedAgentId, existingPrepared, notifyCreating } = args;

	if (existingPrepared) {
		return {
			ok: true,
			worktreePath: existingPrepared.worktree.directory,
			preparedLaunch: existingPrepared,
		};
	}

	notifyCreating();
	const createResult = await tauriClient.git.prepareWorktreeSessionLaunch(
		projectPath,
		selectedAgentId
	);

	if (createResult.isOk()) {
		const preparedLaunch = createResult.value;
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
		return {
			ok: true,
			worktreePath: preparedLaunch.worktree.directory,
			preparedLaunch,
		};
	}

	const failure =
		createResult.error instanceof Error
			? createResult.error
			: new Error("Failed to create worktree. Session will run without branch isolation.");
	return { ok: false, error: failure };
}
