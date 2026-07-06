import { okAsync, Result, type ResultAsync } from "neverthrow";

import type { AppError } from "../../acp/errors/app-error.js";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import type { UserSettingKey } from "../../services/user-settings-types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";

const WORKSPACE_STATE_KEY: UserSettingKey = "workspace_state";
const WORKSPACE_HOT_CACHE_KEY = "acepe.workspace_state.hot_cache";
const storageCommands = TAURI_COMMAND_CLIENT.storage;

const parseWorkspaceState = Result.fromThrowable(
	(stored: string): PersistedWorkspaceState | null => {
		const parsed = JSON.parse(stored) as PersistedWorkspaceState;
		if (parsed && Array.isArray(parsed.panels)) {
			return parsed;
		}
		return null;
	},
	() => null
);

const readWorkspaceHotCacheItem = Result.fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(WORKSPACE_HOT_CACHE_KEY);
	},
	() => null
);

const writeWorkspaceHotCacheItem = Result.fromThrowable(
	(state: PersistedWorkspaceState): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		localStorage.setItem(WORKSPACE_HOT_CACHE_KEY, JSON.stringify(state));
	},
	() => undefined
);

function readWorkspaceHotCache(): PersistedWorkspaceState | null {
	const cachedItemResult = readWorkspaceHotCacheItem();
	const cachedItem = cachedItemResult.isOk() ? cachedItemResult.value : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = parseWorkspaceState(cachedItem);
	if (parsedResult.isOk() && parsedResult.value !== null) {
		return parsedResult.value;
	}

	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(WORKSPACE_HOT_CACHE_KEY);
	}
	return null;
}

function writeWorkspaceHotCache(state: PersistedWorkspaceState): void {
	writeWorkspaceHotCacheItem(state);
}

export const workspace = {
	saveWorkspaceState: (state: PersistedWorkspaceState): ResultAsync<void, AppError> => {
		writeWorkspaceHotCache(state);
		return storageCommands.save_user_setting.invoke<void>({
			key: WORKSPACE_STATE_KEY,
			value: JSON.stringify(state),
		});
	},

	loadWorkspaceState: (): ResultAsync<PersistedWorkspaceState | null, AppError> => {
		const hotCacheState = readWorkspaceHotCache();
		if (hotCacheState !== null) {
			return okAsync(hotCacheState);
		}

		return storageCommands.get_user_setting
			.invoke<string | null>({
				key: WORKSPACE_STATE_KEY,
			})
			.map((stored) => {
				if (stored === null) {
					return null;
				}
				const parsedResult = parseWorkspaceState(stored);
				if (parsedResult.isOk() && parsedResult.value !== null) {
					writeWorkspaceHotCache(parsedResult.value);
					return parsedResult.value;
				}
				return null;
			});
	},
};
