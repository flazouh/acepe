import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { UserSettingKey } from "../../services/converted-session-types.js";
import type { ThreadListSettings } from "./types.js";

const storageCommands = TAURI_COMMAND_CLIENT.storage;

export const settings = {
	getRaw: (key: UserSettingKey): ResultAsync<string | null, AppError> => {
		return storageCommands.get_user_setting.invoke<string | null>({ key });
	},

	get: <T>(key: UserSettingKey): ResultAsync<T | null, AppError> => {
		return storageCommands.get_user_setting.invoke<string | null>({ key }).map((stored) => {
			if (stored === null) return null;
			return JSON.parse(stored) as T;
		});
	},

	set: <T>(key: UserSettingKey, value: T): ResultAsync<void, AppError> => {
		return storageCommands.save_user_setting.invoke<void>({
			key,
			value: JSON.stringify(value),
		});
	},

	setRaw: (key: UserSettingKey, value: string): ResultAsync<void, AppError> => {
		return storageCommands.save_user_setting.invoke<void>({ key, value });
	},

	getCustomKeybindings: (): ResultAsync<Record<string, string>, AppError> => {
		return storageCommands.get_custom_keybindings.invoke<Record<string, string>>();
	},

	saveCustomKeybindings: (keybindings: Record<string, string>): ResultAsync<void, AppError> => {
		return storageCommands.save_custom_keybindings.invoke<void>({ keybindings });
	},

	getThreadListSettings: (): ResultAsync<ThreadListSettings, AppError> => {
		return storageCommands.get_thread_list_settings.invoke<ThreadListSettings>();
	},

	saveThreadListSettings: (settings: ThreadListSettings): ResultAsync<void, AppError> => {
		return storageCommands.save_thread_list_settings.invoke<void>({ settings });
	},

	resetDatabase: (): ResultAsync<void, AppError> => {
		return storageCommands.reset_database.invoke<void>();
	},
};
