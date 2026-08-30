/**
 * First-send worktree path preparation: backend prepare + background setup orchestration.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { toast } from "svelte-sonner";
import { backendClient } from "$lib/utils/backend-client.js";
import type { PreparedWorktreeLaunch } from "../../../types/worktree-info.js";
import type { WorktreeSetupEvent } from "../../../types/worktree-setup.js";
import { createLogger } from "../../../utils/logger.js";
import {
	createWorktreeSetupAbortedEvent,
	createWorktreeSetupStartedEvent,
	projectWorktreeSetupRunEvents,
} from "../../agent-panel/logic/worktree-setup-events.js";
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
 * Reuses an existing prepared launch when present; otherwise calls the backend and runs setup in the background.
 */
export async function prepareWorktreePathForPendingSend(args: {
	projectPath: string;
	selectedAgentId: string;
	existingPrepared: PreparedWorktreeLaunch | null;
	/** Invoked immediately before the backend prepare call (panel pending UX + product hooks). */
	notifyCreating: () => void;
	/**
	 * Receives the setup run's own events — one when the run starts, then the
	 * replay of what each command printed once the server reports it. The panel
	 * folds these into its setup card.
	 */
	onSetupEvent?: (event: WorktreeSetupEvent) => void;
}): Promise<WorktreePrepForSendResult> {
	const { projectPath, selectedAgentId, existingPrepared, notifyCreating, onSetupEvent } = args;

	if (existingPrepared) {
		return {
			ok: true,
			worktreePath: existingPrepared.worktree.directory,
			preparedLaunch: existingPrepared,
		};
	}

	notifyCreating();
	const createResult = await Effect.runPromise(
		Effect.result(backendClient.git.prepareWorktreeSessionLaunch(projectPath, selectedAgentId))
	);

	if (Result.isSuccess(createResult)) {
		const preparedLaunch = createResult.success;
		const worktreePath = preparedLaunch.worktree.directory;

		onSetupEvent?.(createWorktreeSetupStartedEvent({ projectPath, worktreePath }));

		void Effect.runPromise(
			runWorktreeSetup({
				projectPath,
				worktreeCwd: worktreePath,
			}).pipe(
				Effect.match({
					onSuccess: (result) => {
						for (const event of projectWorktreeSetupRunEvents({
							projectPath,
							worktreePath,
							commands: result.commands,
							success: result.setupSuccess,
							error: result.error,
						})) {
							onSetupEvent?.(event);
						}
						if (!result.setupSuccess) toast.warning("Setup script failed");
					},
					onFailure: (error) => {
						logger.warn("Worktree setup failed", { error });
						onSetupEvent?.(
							createWorktreeSetupAbortedEvent({
								projectPath,
								worktreePath,
								error: error.message,
							})
						);
						toast.warning("Setup script failed");
					},
				})
			)
		);

		return {
			ok: true,
			worktreePath,
			preparedLaunch,
		};
	}

	const failure =
		createResult.failure instanceof Error
			? createResult.failure
			: new Error("Failed to create worktree. Session will run without branch isolation.");
	return { ok: false, error: failure };
}
