import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { okAsync } from "neverthrow";

const getUserSettingsInvoke = mock((args: { keys: string[] }) =>
	okAsync(
		args.keys.map((key) => ({
			key,
			value: key === "has_seen_splash" ? "true" : null,
		}))
	)
);
const getCustomKeybindingsInvoke = mock(() => okAsync({ "app.open": "$mod+o" }));
const saveCustomKeybindingsInvoke = mock((_args: { keybindings: Record<string, string> }) =>
	okAsync(undefined)
);
type TestThreadListSettings = {
	hiddenProjects: string[];
	archivedSessions?: Array<{
		sessionId: string;
		projectPath: string;
		agentId: string;
	}>;
};
const getThreadListSettingsInvoke = mock(() =>
	okAsync({
		hiddenProjects: ["/repo/hidden"],
		archivedSessions: [],
	})
);
const saveThreadListSettingsInvoke = mock((_args: { settings: TestThreadListSettings }) =>
	okAsync(undefined)
);
const requestDestructiveConfirmationTokenInvoke = mock(() => okAsync("confirmation-token-1"));
const resetDatabaseInvoke = mock(() => okAsync(undefined));

mock.module("../../services/tauri-command-client.js", () => ({
	TAURI_COMMAND_CLIENT: {
		storage: {
			get_user_settings: {
				invoke: getUserSettingsInvoke,
			},
			get_custom_keybindings: {
				invoke: getCustomKeybindingsInvoke,
			},
			save_custom_keybindings: {
				invoke: saveCustomKeybindingsInvoke,
			},
			get_thread_list_settings: {
				invoke: getThreadListSettingsInvoke,
			},
			save_thread_list_settings: {
				invoke: saveThreadListSettingsInvoke,
			},
			request_destructive_confirmation_token: {
				invoke: requestDestructiveConfirmationTokenInvoke,
			},
			reset_database: {
				invoke: resetDatabaseInvoke,
			},
		},
	},
}));

const { settings } = await import("./settings.js");

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let localStorageValues: Map<string, string>;

describe("settings tauri client", () => {
	beforeEach(() => {
		localStorageValues = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: mock((key: string) => localStorageValues.get(key) ?? null),
				setItem: mock((key: string, value: string) => {
					localStorageValues.set(key, value);
				}),
				removeItem: mock((key: string) => {
					localStorageValues.delete(key);
				}),
			} satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
		});
		getUserSettingsInvoke.mockReset();
		getUserSettingsInvoke.mockImplementation((args: { keys: string[] }) =>
			okAsync(
				args.keys.map((key) => ({
					key,
					value: key === "has_seen_splash" ? "true" : null,
				}))
			)
		);
		getCustomKeybindingsInvoke.mockReset();
		getCustomKeybindingsInvoke.mockImplementation(() => okAsync({ "app.open": "$mod+o" }));
		saveCustomKeybindingsInvoke.mockReset();
		saveCustomKeybindingsInvoke.mockImplementation(
			(_args: { keybindings: Record<string, string> }) => okAsync(undefined)
		);
		getThreadListSettingsInvoke.mockReset();
		getThreadListSettingsInvoke.mockImplementation(() =>
			okAsync({
				hiddenProjects: ["/repo/hidden"],
				archivedSessions: [],
			})
		);
		saveThreadListSettingsInvoke.mockReset();
		saveThreadListSettingsInvoke.mockImplementation((_args: { settings: TestThreadListSettings }) =>
			okAsync(undefined)
		);
		requestDestructiveConfirmationTokenInvoke.mockReset();
		requestDestructiveConfirmationTokenInvoke.mockImplementation(() =>
			okAsync("confirmation-token-1")
		);
		resetDatabaseInvoke.mockReset();
		resetDatabaseInvoke.mockImplementation(() => okAsync(undefined));
	});

	afterEach(() => {
		if (originalLocalStorageDescriptor === undefined) {
			Reflect.deleteProperty(globalThis, "localStorage");
			return;
		}
		Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
	});

	it("batches same-tick user setting reads into one command", async () => {
		const splash = settings.getRaw("has_seen_splash").match(
			(value) => value,
			(error) => {
				throw error;
			}
		);
		const defaultAgent = settings.getRaw("default_agent_id").match(
			(value) => value,
			(error) => {
				throw error;
			}
		);

		await expect(Promise.all([splash, defaultAgent])).resolves.toEqual(["true", null]);
		expect(getUserSettingsInvoke).toHaveBeenCalledTimes(1);
		expect(getUserSettingsInvoke).toHaveBeenCalledWith({
			keys: ["has_seen_splash", "default_agent_id"],
		});
	});

	it("loads custom keybindings from the hot cache without invoking Tauri", async () => {
		localStorageValues.set(
			"acepe.custom_keybindings.hot_cache",
			JSON.stringify({
				version: 1,
				keybindings: {
					"app.cached": "$mod+k",
				},
			})
		);

		const keybindings = await settings.getCustomKeybindings();

		expect(keybindings.isOk()).toBe(true);
		expect(keybindings._unsafeUnwrap()).toEqual({
			"app.cached": "$mod+k",
		});
		expect(getCustomKeybindingsInvoke).not.toHaveBeenCalled();
	});

	it("falls back to Tauri and refreshes the custom keybindings hot cache", async () => {
		const keybindings = await settings.getCustomKeybindings();

		expect(keybindings.isOk()).toBe(true);
		expect(keybindings._unsafeUnwrap()).toEqual({
			"app.open": "$mod+o",
		});
		expect(getCustomKeybindingsInvoke).toHaveBeenCalledTimes(1);
		expect(localStorageValues.get("acepe.custom_keybindings.hot_cache")).toBe(
			JSON.stringify({
				version: 1,
				keybindings: {
					"app.open": "$mod+o",
				},
			})
		);
	});

	it("drops malformed custom keybindings hot cache before loading from Tauri", async () => {
		localStorageValues.set("acepe.custom_keybindings.hot_cache", "{not json");

		const keybindings = await settings.getCustomKeybindings();

		expect(keybindings.isOk()).toBe(true);
		expect(keybindings._unsafeUnwrap()).toEqual({
			"app.open": "$mod+o",
		});
		expect(getCustomKeybindingsInvoke).toHaveBeenCalledTimes(1);
		expect(localStorageValues.get("acepe.custom_keybindings.hot_cache")).toBe(
			JSON.stringify({
				version: 1,
				keybindings: {
					"app.open": "$mod+o",
				},
			})
		);
	});

	it("mirrors saved custom keybindings into the hot cache after the save succeeds", async () => {
		const keybindings = {
			"app.save": "$mod+s",
		};

		const result = await settings.saveCustomKeybindings(keybindings);

		expect(result.isOk()).toBe(true);
		expect(saveCustomKeybindingsInvoke).toHaveBeenCalledWith({ keybindings });
		expect(localStorageValues.get("acepe.custom_keybindings.hot_cache")).toBe(
			JSON.stringify({
				version: 1,
				keybindings,
			})
		);
	});

	it("loads thread list settings from the hot cache without invoking Tauri", async () => {
		localStorageValues.set(
			"acepe.thread_list_settings.hot_cache",
			JSON.stringify({
				version: 1,
				settings: {
					hiddenProjects: ["/repo/cached"],
					archivedSessions: [
						{
							sessionId: "session-1",
							projectPath: "/repo/cached",
							agentId: "claude-code",
						},
					],
				},
			})
		);

		const settingsResult = await settings.getThreadListSettings();

		expect(settingsResult.isOk()).toBe(true);
		expect(settingsResult._unsafeUnwrap()).toEqual({
			hiddenProjects: ["/repo/cached"],
			archivedSessions: [
				{
					sessionId: "session-1",
					projectPath: "/repo/cached",
					agentId: "claude-code",
				},
			],
		});
		expect(getThreadListSettingsInvoke).not.toHaveBeenCalled();
	});

	it("falls back to Tauri and refreshes the thread list settings hot cache", async () => {
		const settingsResult = await settings.getThreadListSettings();

		expect(settingsResult.isOk()).toBe(true);
		expect(settingsResult._unsafeUnwrap()).toEqual({
			hiddenProjects: ["/repo/hidden"],
			archivedSessions: [],
		});
		expect(getThreadListSettingsInvoke).toHaveBeenCalledTimes(1);
		expect(localStorageValues.get("acepe.thread_list_settings.hot_cache")).toBe(
			JSON.stringify({
				version: 1,
				settings: {
					hiddenProjects: ["/repo/hidden"],
					archivedSessions: [],
				},
			})
		);
	});

	it("mirrors saved thread list settings into the hot cache after the save succeeds", async () => {
		const threadListSettings = {
			hiddenProjects: ["/repo/new-hidden"],
			archivedSessions: [],
		};

		const result = await settings.saveThreadListSettings(threadListSettings);

		expect(result.isOk()).toBe(true);
		expect(saveThreadListSettingsInvoke).toHaveBeenCalledWith({ settings: threadListSettings });
		expect(localStorageValues.get("acepe.thread_list_settings.hot_cache")).toBe(
			JSON.stringify({
				version: 1,
				settings: threadListSettings,
			})
		);
	});

	it("requests a scoped destructive confirmation token before resetting the database", async () => {
		await settings.resetDatabase().match(
			() => undefined,
			(error) => {
				throw error;
			}
		);

		expect(requestDestructiveConfirmationTokenInvoke).toHaveBeenCalledWith({
			operation: "reset_database",
			target: "all-data",
		});
		expect(resetDatabaseInvoke).toHaveBeenCalledWith({
			confirmationToken: "confirmation-token-1",
		});
	});
});
