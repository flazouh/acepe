import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import {
	type RpcSessionSnapshot,
	settingsSnapshotRequest,
	UserSettingKey as ContractUserSettingKey,
} from "@acepe/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AgentError, type AppError } from "../../acp/errors/app-error.js";
import type { UserSettingKey } from "../../services/user-settings-types.js";
import {
	decodeEffect,
	nextCommandId,
	unsupportedOnContract,
	withRpcClient,
} from "./rpc-bridge.ts";
import type { ArchivedSessionRef, ThreadListSettings } from "./types.js";

const CUSTOM_KEYBINDINGS_HOT_CACHE_KEY = "acepe.custom_keybindings.hot_cache";
const CUSTOM_KEYBINDINGS_HOT_CACHE_VERSION = 1;
const THREAD_LIST_SETTINGS_HOT_CACHE_KEY = "acepe.thread_list_settings.hot_cache";
const THREAD_LIST_SETTINGS_HOT_CACHE_VERSION = 1;

interface CustomKeybindingsHotCachePayload {
	readonly version: number;
	readonly keybindings: Record<string, string>;
}

interface ThreadListSettingsHotCachePayload {
	readonly version: number;
	readonly settings: ThreadListSettings;
}

const inflightSettingsSnapshot = Effect.runSync(
	Ref.make<Deferred.Deferred<RpcSessionSnapshot, AppError> | null>(null)
);

const readCustomKeybindingsHotCacheItem = fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(CUSTOM_KEYBINDINGS_HOT_CACHE_KEY);
	},
	() => null
);

const writeCustomKeybindingsHotCacheItem = fromThrowable(
	(keybindings: Record<string, string>): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		const payload: CustomKeybindingsHotCachePayload = {
			version: CUSTOM_KEYBINDINGS_HOT_CACHE_VERSION,
			keybindings,
		};
		localStorage.setItem(CUSTOM_KEYBINDINGS_HOT_CACHE_KEY, JSON.stringify(payload));
	},
	() => undefined
);

const removeCustomKeybindingsHotCacheItem = fromThrowable(
	(): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		localStorage.removeItem(CUSTOM_KEYBINDINGS_HOT_CACHE_KEY);
	},
	() => undefined
);

const normalizeCustomKeybindings = (
	keybindings: Record<string, string>
): Record<string, string> | null => {
	const normalized: Record<string, string> = {};
	for (const [command, key] of Object.entries(keybindings)) {
		if (typeof command !== "string" || typeof key !== "string") {
			return null;
		}
		normalized[command] = key;
	}
	return normalized;
};

const parseCustomKeybindingsHotCache = fromThrowable(
	(stored: string): Record<string, string> | null => {
		const parsed = JSON.parse(stored) as CustomKeybindingsHotCachePayload;
		if (
			!parsed ||
			parsed.version !== CUSTOM_KEYBINDINGS_HOT_CACHE_VERSION ||
			typeof parsed.keybindings !== "object" ||
			parsed.keybindings === null ||
			Array.isArray(parsed.keybindings)
		) {
			return null;
		}
		return normalizeCustomKeybindings(parsed.keybindings);
	},
	() => null
);

const readCustomKeybindingsHotCache = (): Record<string, string> | null => {
	const cachedItemResult = Effect.runSync(Effect.result(readCustomKeybindingsHotCacheItem()));
	const cachedItem = Result.isSuccess(cachedItemResult) ? cachedItemResult.success : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = Effect.runSync(Effect.result(parseCustomKeybindingsHotCache(cachedItem)));
	if (Result.isSuccess(parsedResult) && parsedResult.success !== null) {
		return parsedResult.success;
	}

	void Effect.runSync(Effect.result(removeCustomKeybindingsHotCacheItem()));
	return null;
};

const writeCustomKeybindingsHotCache = (keybindings: Record<string, string>): void => {
	void Effect.runSync(Effect.result(writeCustomKeybindingsHotCacheItem(keybindings)));
};

const readThreadListSettingsHotCacheItem = fromThrowable(
	(): string | null => {
		if (typeof localStorage === "undefined") {
			return null;
		}
		return localStorage.getItem(THREAD_LIST_SETTINGS_HOT_CACHE_KEY);
	},
	() => null
);

const writeThreadListSettingsHotCacheItem = fromThrowable(
	(settings: ThreadListSettings): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		const payload: ThreadListSettingsHotCachePayload = {
			version: THREAD_LIST_SETTINGS_HOT_CACHE_VERSION,
			settings,
		};
		localStorage.setItem(THREAD_LIST_SETTINGS_HOT_CACHE_KEY, JSON.stringify(payload));
	},
	() => undefined
);

const removeThreadListSettingsHotCacheItem = fromThrowable(
	(): void => {
		if (typeof localStorage === "undefined") {
			return;
		}
		localStorage.removeItem(THREAD_LIST_SETTINGS_HOT_CACHE_KEY);
	},
	() => undefined
);

const normalizeArchivedSessionRefs = (
	refs: readonly ArchivedSessionRef[] | undefined
): ArchivedSessionRef[] | undefined => {
	if (refs === undefined) {
		return undefined;
	}
	if (!Array.isArray(refs)) {
		return undefined;
	}

	const normalized: ArchivedSessionRef[] = [];
	for (const ref of refs) {
		if (
			typeof ref.sessionId !== "string" ||
			typeof ref.projectPath !== "string" ||
			typeof ref.agentId !== "string"
		) {
			return undefined;
		}
		normalized.push({
			sessionId: ref.sessionId,
			projectPath: ref.projectPath,
			agentId: ref.agentId,
		});
	}
	return normalized;
};

const normalizeThreadListSettings = (settings: ThreadListSettings): ThreadListSettings | null => {
	if (!Array.isArray(settings.hiddenProjects)) {
		return null;
	}

	const hiddenProjects: string[] = [];
	for (const projectPath of settings.hiddenProjects) {
		if (typeof projectPath !== "string") {
			return null;
		}
		hiddenProjects.push(projectPath);
	}

	const archivedSessions = normalizeArchivedSessionRefs(settings.archivedSessions);
	if (settings.archivedSessions !== undefined && archivedSessions === undefined) {
		return null;
	}

	return {
		hiddenProjects,
		archivedSessions,
	};
};

const parseThreadListSettingsHotCache = fromThrowable(
	(stored: string): ThreadListSettings | null => {
		const parsed = JSON.parse(stored) as ThreadListSettingsHotCachePayload;
		if (!parsed || parsed.version !== THREAD_LIST_SETTINGS_HOT_CACHE_VERSION || !parsed.settings) {
			return null;
		}
		return normalizeThreadListSettings(parsed.settings);
	},
	() => null
);

const readThreadListSettingsHotCache = (): ThreadListSettings | null => {
	const cachedItemResult = Effect.runSync(Effect.result(readThreadListSettingsHotCacheItem()));
	const cachedItem = Result.isSuccess(cachedItemResult) ? cachedItemResult.success : null;
	if (cachedItem === null) {
		return null;
	}

	const parsedResult = Effect.runSync(Effect.result(parseThreadListSettingsHotCache(cachedItem)));
	if (Result.isSuccess(parsedResult) && parsedResult.success !== null) {
		return parsedResult.success;
	}

	void Effect.runSync(Effect.result(removeThreadListSettingsHotCacheItem()));
	return null;
};

const writeThreadListSettingsHotCache = (settings: ThreadListSettings): void => {
	void Effect.runSync(Effect.result(writeThreadListSettingsHotCacheItem(settings)));
};

const loadSettingsSnapshot = Effect.fn("loadSettingsSnapshot")(function* () {
	const created = yield* Deferred.make<RpcSessionSnapshot, AppError>();
	const selected = yield* Ref.modify(inflightSettingsSnapshot, (current) => {
		if (current !== null) {
			return [current, current] as const;
		}
		return [created, created] as const;
	});
	if (selected !== created) {
		return yield* Deferred.await(selected);
	}
	yield* Effect.yieldNow;
	const result = yield* Effect.result(
		withRpcClient("settings.snapshot", (client) => client.snapshot(settingsSnapshotRequest()))
	);
	yield* Ref.set(inflightSettingsSnapshot, null);
	if (Result.isFailure(result)) {
		yield* Deferred.fail(created, result.failure);
		return yield* Effect.fail(result.failure);
	}
	yield* Deferred.succeed(created, result.success);
	return result.success;
});

const valueForKey = (snapshot: RpcSessionSnapshot, key: UserSettingKey): string | null => {
	for (const row of snapshot.settings) {
		if (row.key === key) {
			return row.value;
		}
	}
	return null;
};

const parseJsonValue = <T>(stored: string): Effect.Effect<T, AppError> =>
	Effect.try({
		try: () => JSON.parse(stored) as T,
		catch: (cause) =>
			new AgentError(
				"settings.get",
				cause instanceof Error ? cause : new Error("settings.get")
			),
	});

const dispatchSettingsSet = Effect.fn("dispatchSettingsSet")(function* (
	key: UserSettingKey,
	value: string
) {
	const commandId = yield* nextCommandId("settings-set");
	const decodedKey = yield* decodeEffect(
		"settings.set",
		Schema.decodeUnknownEffect(ContractUserSettingKey)
	)(key);
	yield* withRpcClient("settings.set", (client) =>
		client.dispatch({
			type: "settings.set",
			commandId,
			key: decodedKey,
			value,
		})
	);
});

export const settings = {
	getRaw: (key: UserSettingKey): Effect.Effect<string | null, AppError> =>
		loadSettingsSnapshot().pipe(Effect.map((snapshot) => valueForKey(snapshot, key))),

	get: <T>(key: UserSettingKey): Effect.Effect<T | null, AppError> =>
		loadSettingsSnapshot().pipe(
			Effect.flatMap((snapshot) => {
				const stored = valueForKey(snapshot, key);
				if (stored === null) {
					return Effect.succeed(null);
				}
				return parseJsonValue<T>(stored);
			})
		),

	set: <T>(key: UserSettingKey, value: T): Effect.Effect<void, AppError> =>
		dispatchSettingsSet(key, JSON.stringify(value)),

	setRaw: (key: UserSettingKey, value: string): Effect.Effect<void, AppError> =>
		dispatchSettingsSet(key, value),

	getCustomKeybindings: (): Effect.Effect<Record<string, string>, AppError> => {
		const cachedKeybindings = readCustomKeybindingsHotCache();
		if (cachedKeybindings !== null) {
			return Effect.succeed(cachedKeybindings);
		}
		return loadSettingsSnapshot().pipe(
			Effect.map((snapshot) => {
				const stored = valueForKey(snapshot, "custom_keybindings");
				if (stored === null) {
					return {};
				}
				const parsedResult = Effect.runSync(
					Effect.result(parseJsonValue<Record<string, string>>(stored))
				);
				if (Result.isFailure(parsedResult)) {
					return {};
				}
				const normalized = normalizeCustomKeybindings(parsedResult.success);
				if (normalized === null) {
					return {};
				}
				writeCustomKeybindingsHotCache(normalized);
				return normalized;
			})
		);
	},

	saveCustomKeybindings: (
		keybindings: Record<string, string>
	): Effect.Effect<void, AppError> =>
		dispatchSettingsSet("custom_keybindings", JSON.stringify(keybindings)).pipe(
			Effect.map(() => {
				writeCustomKeybindingsHotCache(keybindings);
				return undefined;
			})
		),

	getThreadListSettings: (): Effect.Effect<ThreadListSettings, AppError> => {
		const cachedSettings = readThreadListSettingsHotCache();
		if (cachedSettings !== null) {
			return Effect.succeed(cachedSettings);
		}
		return Effect.succeed({
			hiddenProjects: [],
			archivedSessions: [],
		});
	},

	saveThreadListSettings: (
		threadListSettings: ThreadListSettings
	): Effect.Effect<void, AppError> => {
		writeThreadListSettingsHotCache(threadListSettings);
		return Effect.void;
	},

	resetDatabase: (): Effect.Effect<void, AppError> =>
		unsupportedOnContract("storage.reset_database"),
};
