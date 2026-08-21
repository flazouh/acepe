import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { AppError } from "../../acp/errors/app-error.js";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { UserSettingKey } from "../../services/user-settings-types.js";

const WORKSPACE_STATE_KEY: UserSettingKey = "workspace_state";
const WORKSPACE_HOT_CACHE_KEY = "acepe.workspace_state.hot_cache";
const storageCommands = TAURI_COMMAND_CLIENT.storage;

const parseWorkspaceState = fromThrowable(
	(stored: string): PersistedWorkspaceState | null => {
		const parsed = JSON.parse(stored) as PersistedWorkspaceState;
		if (parsed && Array.isArray(parsed.panels)) {
			return parsed;
		}
		return null;
	},
	() => null
);

const readWorkspaceHotCacheItem = fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(WORKSPACE_HOT_CACHE_KEY);
	},
	() => null
);

const writeWorkspaceHotCacheItem = fromThrowable(
	(state: PersistedWorkspaceState): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		localStorage.setItem(WORKSPACE_HOT_CACHE_KEY, JSON.stringify(state));
	},
	() => undefined
);

function readWorkspaceHotCache(): PersistedWorkspaceState | null {
	const cachedItemResult = Effect.runSync(Effect.result(readWorkspaceHotCacheItem()));
	const cachedItem = Result.isSuccess(cachedItemResult) ? cachedItemResult.success : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = Effect.runSync(Effect.result(parseWorkspaceState(cachedItem)));
	if (Result.isSuccess(parsedResult) && parsedResult.success !== null) {
		return parsedResult.success;
	}

	if (typeof localStorage !== "undefined") {
		localStorage.removeItem(WORKSPACE_HOT_CACHE_KEY);
	}
	return null;
}

function writeWorkspaceHotCache(state: PersistedWorkspaceState): void {
	void Effect.runSync(Effect.result(writeWorkspaceHotCacheItem(state)));
}

export const workspace = {
	saveWorkspaceState: (state: PersistedWorkspaceState): Effect.Effect<void, AppError> => {
		writeWorkspaceHotCache(state);
		return storageCommands.save_user_setting.invoke<void>({
			key: WORKSPACE_STATE_KEY,
			value: JSON.stringify(state),
		});
	},

	loadWorkspaceState: (): Effect.Effect<PersistedWorkspaceState | null, AppError> => {
		const hotCacheState = readWorkspaceHotCache();
		if (hotCacheState !== null) {
			return Effect.succeed(hotCacheState);
		}

		return storageCommands.get_user_setting
			.invoke<string | null>({
				key: WORKSPACE_STATE_KEY,
			})
			.pipe(
				Effect.map((stored) => {
					if (stored === null) {
						return null;
					}
					const parsedResult = Effect.runSync(Effect.result(parseWorkspaceState(stored)));
					if (Result.isSuccess(parsedResult) && parsedResult.success !== null) {
						writeWorkspaceHotCache(parsedResult.success);
						return parsedResult.success;
					}
					return null;
				})
			);
	},
};
