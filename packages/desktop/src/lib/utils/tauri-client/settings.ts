import type { ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import { CMD } from "./commands.js";

import { invokeAsync } from "./invoke.js";
import type { ThreadListSettings } from "./types.js";

export const settings = {
	getRaw: (key: string): ResultAsync<string | null, AppError> => {
		return invokeAsync<string | null>(CMD.settings.get_user_setting, { key });
	},

	get: <T>(key: string): ResultAsync<T | null, AppError> => {
		return invokeAsync<string | null>(CMD.settings.get_user_setting, { key }).map((stored) => {
			if (stored === null) return null;
			return JSON.parse(stored) as T;
		});
	},

	set: <T>(key: string, value: T): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.save_user_setting, {
			key,
			value: JSON.stringify(value),
		});
	},

	setRaw: (key: string, value: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.save_user_setting, { key, value });
	},

	getCustomKeybindings: (): ResultAsync<Record<string, string>, AppError> => {
		return invokeAsync(CMD.settings.get_custom_keybindings);
	},

	saveCustomKeybindings: (keybindings: Record<string, string>): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.save_custom_keybindings, { keybindings });
	},

	getThreadListSettings: (): ResultAsync<ThreadListSettings, AppError> => {
		return invokeAsync(CMD.settings.get_thread_list_settings);
	},

	saveThreadListSettings: (settings: ThreadListSettings): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.save_thread_list_settings, { settings });
	},

	resetDatabase: (): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.settings.reset_database);
	},
};
