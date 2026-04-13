import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { UserSettingKey } from "../../services/converted-session-types.js";

const WORKSPACE_STATE_KEY: UserSettingKey = "workspace_state";
const storageCommands = TAURI_COMMAND_CLIENT.storage;

export const workspace = {
	saveWorkspaceState: (state: PersistedWorkspaceState): ResultAsync<void, AppError> => {
		return storageCommands.save_user_setting.invoke<void>({
			key: WORKSPACE_STATE_KEY,
			value: JSON.stringify(state),
		});
	},

	loadWorkspaceState: (): ResultAsync<PersistedWorkspaceState | null, AppError> => {
		return storageCommands.get_user_setting.invoke<string | null>({
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
