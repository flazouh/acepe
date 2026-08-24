import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;

// save/get/delete all stay on TAURI_COMMAND_CLIENT: they read from and write
// to the Rust-owned session_review_state SQLite table (FK'd to the Rust-owned
// session_metadata table), and all three have live callers through
// SessionReviewStateStore (packages/desktop/src/lib/acp/store/
// session-review-state-store.svelte.ts). There is no zero-caller method here
// to retire to unsupportedOnContract.
//
// This is a different domain from the contract's existing git review surface
// (ProjectedGitReview / projection_git_review, packages/contracts/src/git.ts),
// not an overlapping one a new field could bridge:
//   - scope: git review is keyed by projectId, one row per project. Session
//     review state is keyed by sessionId, one row per session.
//   - grain: git review's hunkDecisions track accept/reject per hunk within a
//     file's diff. Session review state tracks a single reviewed/unreviewed
//     boolean per whole file, keyed by a revisionKey (file path + content
//     hash) so a file re-marks itself unreviewed when it changes.
// Moving this onto the contract would mean designing a new session-scoped
// projection (table + dispatch command(s) + snapshot field + reducer), not
// extending the git review projection with a missing field. session.meta.update
// (packages/contracts/src/orchestration.ts) is a fixed-shape command (title/
// prNumber/prLinkMode) and not a generic per-session KV store either, so there
// is no existing command this can ride without a schema change of its own.
// That is a real slice of new infrastructure, out of this batch's budget; see
// the #249 issue thread (batch 2 map) for the follow-up slice.
export const sessionReviewState = {
	save: (sessionId: string, stateJson: string): Effect.Effect<void, AppError> => {
		return storageCommands.save_session_review_state.invoke<void>({
			sessionId,
			stateJson,
		});
	},

	get: (sessionId: string): Effect.Effect<string | null, AppError> => {
		return storageCommands.get_session_review_state.invoke<string | null>({ sessionId });
	},

	delete: (sessionId: string): Effect.Effect<void, AppError> => {
		return storageCommands.delete_session_review_state.invoke<void>({ sessionId });
	},
};
