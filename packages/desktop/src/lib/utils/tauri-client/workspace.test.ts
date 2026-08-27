import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
	SessionId,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import type { PersistedWorkspaceState } from "../../acp/store/types.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { workspace } from "./workspace.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const withSettings = (
	snapshot: RpcSessionSnapshot,
	settingsRows: RpcSessionSnapshot["settings"]
): RpcSessionSnapshot => ({
	...snapshot,
	settings: settingsRows,
});

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	readTextFile: () => Effect.succeed(""),
	writeTextFile: () => Effect.void,
	getDefaultShell: () => Effect.succeed("/bin/zsh"),
	gitCall: () => Effect.succeed({ op: "git.isRepo" as const, isRepo: false }),
	agentCall: () => Effect.succeed({ op: "agent.list" as const, agents: [] }),
	getProviderAccountUsage: () => Effect.succeed([]),
	listProviderSessions: () => Effect.succeed([]),
	listProviderProjects: () => Effect.succeed([]),
	importProviderSession: () =>
		Effect.succeed({ sessionId: SessionId.make("session-1"), imported: false }),
	events: () => Stream.empty,
	...overrides,
});

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
				getItem: (key: string) => localStorageValues.get(key) ?? null,
				setItem: (key: string, value: string) => {
					localStorageValues.set(key, value);
				},
				removeItem: (key: string) => {
					localStorageValues.delete(key);
				},
			} satisfies Pick<Storage, "getItem" | "setItem" | "removeItem">,
		});
	});

	afterEach(() => {
		setAppRpcClientForTest(null);
		if (originalLocalStorageDescriptor === undefined) {
			Reflect.deleteProperty(globalThis, "localStorage");
			return;
		}
		Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
	});

	it("loads workspace state from the hot cache without invoking the contract", async () => {
		const cached = buildWorkspaceState(12);
		localStorageValues.set("acepe.workspace_state.hot_cache", JSON.stringify(cached));
		let snapshotCalls = 0;
		setAppRpcClientForTest(
			makeClient({
				snapshot: () => {
					snapshotCalls += 1;
					return Effect.succeed(emptyRpcSessionSnapshot(0));
				},
			})
		);

		const loaded = await Effect.runPromise(Effect.result(workspace.loadWorkspaceState()));

		expect(Result.isSuccess(loaded)).toBe(true);
		expect(Result.getOrThrow(loaded)?.version).toBe(12);
		expect(snapshotCalls).toBe(0);
	});

	it("mirrors saved workspace state into the hot cache and dispatches settings.set", async () => {
		const state = buildWorkspaceState(13);
		let dispatched: unknown = null;
		setAppRpcClientForTest(
			makeClient({
				dispatch: (command) => {
					dispatched = command;
					return Effect.succeed({ sequence: 2 });
				},
			})
		);

		const result = await Effect.runPromise(Effect.result(workspace.saveWorkspaceState(state)));

		expect(Result.isSuccess(result)).toBe(true);
		expect(dispatched).toMatchObject({
			type: "settings.set",
			key: "workspace_state",
			value: JSON.stringify(state),
		});
		expect(localStorageValues.get("acepe.workspace_state.hot_cache")).toBe(JSON.stringify(state));
	});

	it("falls back to the contract and refreshes the hot cache when the cache is malformed", async () => {
		const persisted = buildWorkspaceState(14);
		localStorageValues.set("acepe.workspace_state.hot_cache", "{not json");
		let requestedSnapshot = false;
		setAppRpcClientForTest(
			makeClient({
				snapshot: () => {
					requestedSnapshot = true;
					return Effect.succeed(
						withSettings(emptyRpcSessionSnapshot(0), [
							{ key: "workspace_state", value: JSON.stringify(persisted), sequence: 1 },
						])
					);
				},
			})
		);

		const loaded = await Effect.runPromise(Effect.result(workspace.loadWorkspaceState()));

		expect(Result.isSuccess(loaded)).toBe(true);
		expect(Result.getOrThrow(loaded)?.version).toBe(14);
		expect(requestedSnapshot).toBe(true);
		expect(localStorageValues.get("acepe.workspace_state.hot_cache")).toBe(
			JSON.stringify(persisted)
		);
	});
});
