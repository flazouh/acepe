import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import type { UserSettingKey } from "../../services/converted-session-types.js";
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

const WORKSPACE_STATE_KEY: UserSettingKey = "workspace_state";

export const workspace = {
	saveWorkspaceState: (state: PersistedWorkspaceState): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.storage.save_user_setting, {
			key: WORKSPACE_STATE_KEY,
			value: JSON.stringify(state),
		});
	},

	loadWorkspaceState: (): ResultAsync<PersistedWorkspaceState | null, AppError> => {
		return invokeAsync<string | null>(CMD.storage.get_user_setting, {
			key: WORKSPACE_STATE_KEY,
		}).map((stored) => {
			if (stored === null) {
				return null;
			}
			const parsed = JSON.parse(stored);
			if (parsed && Array.isArray(parsed.panels)) {
				return parsed as PersistedWorkspaceState;
			}
			return null;
		});
	},
};
