import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;

export const sessionReviewState = {
	save: (sessionId: string, stateJson: string): ResultAsync<void, AppError> => {
		return storageCommands.save_session_review_state.invoke<void>({
			sessionId,
			stateJson,
		});
	},

	get: (sessionId: string): ResultAsync<string | null, AppError> => {
		return storageCommands.get_session_review_state.invoke<string | null>({ sessionId });
	},

	delete: (sessionId: string): ResultAsync<void, AppError> => {
		return storageCommands.delete_session_review_state.invoke<void>({ sessionId });
	},
};
