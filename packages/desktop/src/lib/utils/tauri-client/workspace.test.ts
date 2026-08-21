import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";

const getUserSettingInvoke = mock(() => Effect.succeed(null as string | null));
const saveUserSettingInvoke = mock(() => Effect.succeed(undefined));

mock.module("../../services/tauri-command-client.js", () => ({
	TAURI_COMMAND_CLIENT: {
		storage: {
			get_user_setting: {
				invoke: getUserSettingInvoke,
			},
			save_user_setting: {
				invoke: saveUserSettingInvoke,
			},
		},
	},
}));

const workspaceModulePath = "./workspace.js?hot-cache-test" as string;
const { workspace } = (await import(workspaceModulePath)) as typeof import("./workspace.js");

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let localStorageValues: Map<string, string>;

function buildWorkspaceState(version: number): PersistedWorkspaceState {
	return {
		version,
		workspacePanels: [],
		panels: [],
		filePanels: [],
		activeFilePanelIdByOwnerPanelId: {},
		focusedPanelIndex: null,
		panelContainerScrollX: 0,
		savedAt: "2026-07-03T00:00:00.000Z",
	};
}

describe("workspace tauri client", () => {
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
		getUserSettingInvoke.mockReset();
		getUserSettingInvoke.mockImplementation(() => Effect.succeed(null as string | null));
		saveUserSettingInvoke.mockReset();
		saveUserSettingInvoke.mockImplementation(() => Effect.succeed(undefined));
	});

	afterEach(() => {
		if (originalLocalStorageDescriptor === undefined) {
			Reflect.deleteProperty(globalThis, "localStorage");
			return;
		}
		Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
	});

	it("loads workspace state from the hot cache without invoking Tauri", async () => {
		const cached = buildWorkspaceState(12);
		localStorageValues.set("acepe.workspace_state.hot_cache", JSON.stringify(cached));

		const loaded = await Effect.runPromise(Effect.result(workspace.loadWorkspaceState()));

		expect(Result.isSuccess(loaded)).toBe(true);
		expect(Result.getOrThrow(loaded)?.version).toBe(12);
		expect(getUserSettingInvoke).not.toHaveBeenCalled();
	});

	it("mirrors saved workspace state into the hot cache", async () => {
		const state = buildWorkspaceState(13);

		const result = await Effect.runPromise(Effect.result(workspace.saveWorkspaceState(state)));

		expect(Result.isSuccess(result)).toBe(true);
		expect(saveUserSettingInvoke).toHaveBeenCalledWith({
			key: "workspace_state",
			value: JSON.stringify(state),
		});
		expect(localStorageValues.get("acepe.workspace_state.hot_cache")).toBe(JSON.stringify(state));
	});

	it("falls back to Tauri and refreshes the hot cache when the cache is malformed", async () => {
		const persisted = buildWorkspaceState(14);
		localStorageValues.set("acepe.workspace_state.hot_cache", "{not json");
		getUserSettingInvoke.mockImplementation(() => Effect.succeed(JSON.stringify(persisted)));

		const loaded = await Effect.runPromise(Effect.result(workspace.loadWorkspaceState()));

		expect(Result.isSuccess(loaded)).toBe(true);
		expect(Result.getOrThrow(loaded)?.version).toBe(14);
		expect(getUserSettingInvoke).toHaveBeenCalledWith({
			key: "workspace_state",
		});
		expect(localStorageValues.get("acepe.workspace_state.hot_cache")).toBe(
			JSON.stringify(persisted)
		);
	});
});
