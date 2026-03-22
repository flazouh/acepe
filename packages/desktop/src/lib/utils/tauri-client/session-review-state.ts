import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const sessionReviewState = {
	save: (sessionId: string, stateJson: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.save_session_review_state, {
			sessionId,
			stateJson,
		});
	},

	get: (sessionId: string): ResultAsync<string | null, AppError> => {
		return invokeAsync<string | null>(CMD.settings.get_session_review_state, { sessionId });
	},

	delete: (sessionId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.delete_session_review_state, { sessionId });
	},
};
