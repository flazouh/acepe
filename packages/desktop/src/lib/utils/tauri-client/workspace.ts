import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { AppError } from "../../acp/errors/app-error.js";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import { isQaSandboxed } from "../../qa/qa-sandbox.ts";
import type { UserSettingKey } from "../../services/user-settings-types.js";
import { settings } from "./settings.ts";

const WORKSPACE_STATE_KEY: UserSettingKey = "workspace_state";
const WORKSPACE_HOT_CACHE_KEY = "acepe.workspace_state.hot_cache";

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
	if (isQaSandboxed() === true) {
		return null;
	}
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

/**
 * The hot cache is the one part of workspace state that outlives a QA replay:
 * the settings write goes through the scenario's fake client and lands nowhere,
 * but `localStorage` is the real app's. A replay that cached its panel layout
 * here handed the user someone else's workspace on the next launch.
 */
function writeWorkspaceHotCache(state: PersistedWorkspaceState): void {
	if (isQaSandboxed() === true) {
		return;
	}
	void Effect.runSync(Effect.result(writeWorkspaceHotCacheItem(state)));
}

export const workspace = {
	saveWorkspaceState: (state: PersistedWorkspaceState): Effect.Effect<void, AppError> => {
		writeWorkspaceHotCache(state);
		return settings.setRaw(WORKSPACE_STATE_KEY, JSON.stringify(state));
	},

	loadWorkspaceState: (): Effect.Effect<PersistedWorkspaceState | null, AppError> => {
		const hotCacheState = readWorkspaceHotCache();
		if (hotCacheState !== null) {
			return Effect.succeed(hotCacheState);
		}

		return settings.getRaw(WORKSPACE_STATE_KEY).pipe(
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
