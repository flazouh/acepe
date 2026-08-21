import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { AgentError, AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type { UserSettingKey } from "../../services/user-settings-types.js";
import type { ArchivedSessionRef, ThreadListSettings } from "./types.js";

interface UserSettingValue {
	readonly key: UserSettingKey;
	readonly value: string | null;
}

interface PendingSettingsBatchRequest {
	readonly key: UserSettingKey;
	readonly resolve: (value: string | null) => void;
	readonly reject: (error: AppError) => void;
}

const pendingSettingsBatch: PendingSettingsBatchRequest[] = [];
let settingsBatchFlushScheduled = false;
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

function normalizeCustomKeybindings(
	keybindings: Record<string, string>
): Record<string, string> | null {
	const normalized: Record<string, string> = {};
	for (const [command, key] of Object.entries(keybindings)) {
		if (typeof command !== "string" || typeof key !== "string") {
			return null;
		}
		normalized[command] = key;
	}
	return normalized;
}

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

function readCustomKeybindingsHotCache(): Record<string, string> | null {
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
}

function writeCustomKeybindingsHotCache(keybindings: Record<string, string>): void {
	void Effect.runSync(Effect.result(writeCustomKeybindingsHotCacheItem(keybindings)));
}

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

function normalizeArchivedSessionRefs(
	refs: readonly ArchivedSessionRef[] | undefined
): ArchivedSessionRef[] | undefined {
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
}

function normalizeThreadListSettings(settings: ThreadListSettings): ThreadListSettings | null {
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
}

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

function readThreadListSettingsHotCache(): ThreadListSettings | null {
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
}

function writeThreadListSettingsHotCache(settings: ThreadListSettings): void {
	void Effect.runSync(Effect.result(writeThreadListSettingsHotCacheItem(settings)));
}

function normalizeSettingsBatchError<TError>(error: TError): AppError {
	if (error instanceof AppError) {
		return error;
	}
	if (error instanceof Error) {
		return new AgentError("get_user_settings", error);
	}
	return new AgentError("get_user_settings", new Error(String(error)));
}

function scheduleSettingsBatchFlush(): void {
	if (settingsBatchFlushScheduled) {
		return;
	}
	settingsBatchFlushScheduled = true;
	queueMicrotask(flushSettingsBatch);
}

function flushSettingsBatch(): void {
	const batch = pendingSettingsBatch.splice(0, pendingSettingsBatch.length);
	settingsBatchFlushScheduled = false;
	if (batch.length === 0) {
		return;
	}

	const seenKeys = new Set<UserSettingKey>();
	const keys: UserSettingKey[] = [];
	for (const request of batch) {
		if (seenKeys.has(request.key)) {
			continue;
		}
		seenKeys.add(request.key);
		keys.push(request.key);
	}

	void Effect.runPromise(
		TAURI_COMMAND_CLIENT.storage.get_user_settings.invoke<UserSettingValue[]>({ keys }).pipe(
			Effect.match({
				onSuccess: (values) => {
					const valuesByKey = new Map<UserSettingKey, string | null>();
					for (const value of values) {
						valuesByKey.set(value.key, value.value);
					}
					for (const request of batch) {
						request.resolve(valuesByKey.get(request.key) ?? null);
					}
				},
				onFailure: (error) => {
					for (const request of batch) {
						request.reject(error);
					}
				},
			})
		)
	);
}

function getRawBatched(key: UserSettingKey): Effect.Effect<string | null, AppError> {
	return fromPromise(
		() =>
			new Promise<string | null>((resolve, reject) => {
				pendingSettingsBatch.push({
					key,
					resolve,
					reject,
				});
				scheduleSettingsBatchFlush();
			}),
		normalizeSettingsBatchError
	);
}

export const settings = {
	getRaw: (key: UserSettingKey): Effect.Effect<string | null, AppError> => {
		return getRawBatched(key);
	},

	get: <T>(key: UserSettingKey): Effect.Effect<T | null, AppError> => {
		return getRawBatched(key).pipe(
			Effect.map((stored) => {
				if (stored === null) return null;
				return JSON.parse(stored) as T;
			})
		);
	},

	set: <T>(key: UserSettingKey, value: T): Effect.Effect<void, AppError> => {
		return TAURI_COMMAND_CLIENT.storage.save_user_setting.invoke<void>({
			key,
			value: JSON.stringify(value),
		});
	},

	setRaw: (key: UserSettingKey, value: string): Effect.Effect<void, AppError> => {
		return TAURI_COMMAND_CLIENT.storage.save_user_setting.invoke<void>({ key, value });
	},

	getCustomKeybindings: (): Effect.Effect<Record<string, string>, AppError> => {
		const cachedKeybindings = readCustomKeybindingsHotCache();
		if (cachedKeybindings !== null) {
			return Effect.succeed(cachedKeybindings);
		}

		return TAURI_COMMAND_CLIENT.storage.get_custom_keybindings
			.invoke<Record<string, string>>()
			.pipe(
				Effect.map((keybindings) => {
					writeCustomKeybindingsHotCache(keybindings);
					return keybindings;
				})
			);
	},

	saveCustomKeybindings: (keybindings: Record<string, string>): Effect.Effect<void, AppError> => {
		return TAURI_COMMAND_CLIENT.storage.save_custom_keybindings
			.invoke<void>({ keybindings })
			.pipe(
				Effect.map(() => {
					writeCustomKeybindingsHotCache(keybindings);
					return undefined;
				})
			);
	},

	getThreadListSettings: (): Effect.Effect<ThreadListSettings, AppError> => {
		const cachedSettings = readThreadListSettingsHotCache();
		if (cachedSettings !== null) {
			return Effect.succeed(cachedSettings);
		}

		return TAURI_COMMAND_CLIENT.storage.get_thread_list_settings
			.invoke<ThreadListSettings>()
			.pipe(
				Effect.map((threadListSettings) => {
					writeThreadListSettingsHotCache(threadListSettings);
					return threadListSettings;
				})
			);
	},

	saveThreadListSettings: (threadListSettings: ThreadListSettings): Effect.Effect<void, AppError> => {
		return TAURI_COMMAND_CLIENT.storage.save_thread_list_settings
			.invoke<void>({ settings: threadListSettings })
			.pipe(
				Effect.map(() => {
					writeThreadListSettingsHotCache(threadListSettings);
					return undefined;
				})
			);
	},

	resetDatabase: (): Effect.Effect<void, AppError> => {
		return TAURI_COMMAND_CLIENT.storage.request_destructive_confirmation_token
			.invoke<string>({
				operation: "reset_database",
				target: "all-data",
			})
			.pipe(
				Effect.flatMap((confirmationToken) =>
					TAURI_COMMAND_CLIENT.storage.reset_database.invoke<void>({ confirmationToken })
				)
			);
	},
};
