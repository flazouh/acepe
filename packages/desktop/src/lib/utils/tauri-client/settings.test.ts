import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	type RpcClient,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { AgentError } from "../../acp/errors/app-error.js";
import { setAppRpcClientForTest } from "../../rpc/app-client.ts";
import { settings } from "./settings.ts";

const unusedIndex = {
	projectPath: "/tmp/p",
	files: [],
	gitStatus: [],
	totalFiles: 0,
	totalLines: 0,
};

const makeClient = (overrides: Partial<RpcClient>): RpcClient => ({
	dispatch: () => Effect.succeed({ sequence: 1 }),
	snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(0)),
	getProjectIndex: () => Effect.succeed(unusedIndex),
	invalidateProjectIndex: () => Effect.void,
	events: () => Stream.empty,
	...overrides,
});

const withSettings = (
	snapshot: RpcSessionSnapshot,
	settingsRows: RpcSessionSnapshot["settings"]
): RpcSessionSnapshot => ({
	...snapshot,
	settings: settingsRows,
});

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"localStorage"
);
let localStorageValues: Map<string, string>;

afterEach(() => {
	setAppRpcClientForTest(null);
	if (originalLocalStorageDescriptor === undefined) {
		Reflect.deleteProperty(globalThis, "localStorage");
		return;
	}
	Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
});

describe("settings rpc facade", () => {
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
	});

	it("batches same-tick raw reads into one snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let snapshotCount = 0;
				setAppRpcClientForTest(
					makeClient({
						snapshot: () => {
							snapshotCount += 1;
							return Effect.succeed(
								withSettings(emptyRpcSessionSnapshot(0), [
									{
										key: "has_seen_splash",
										value: "true",
										sequence: 1,
									},
								])
							);
						},
					})
				);
				const [splash, defaultAgent] = yield* Effect.all(
					[
						settings.getRaw("has_seen_splash"),
						settings.getRaw("default_agent_id"),
					],
					{ concurrency: "unbounded" }
				);
				expect(splash).toBe("true");
				expect(defaultAgent).toBeNull();
				expect(snapshotCount).toBe(1);
			})
		));

	it("loads custom keybindings from the hot cache without snapshot", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let snapshotCount = 0;
				localStorageValues.set(
					"acepe.custom_keybindings.hot_cache",
					JSON.stringify({
						version: 1,
						keybindings: {
							"app.cached": "$mod+k",
						},
					})
				);
				setAppRpcClientForTest(
					makeClient({
						snapshot: () => {
							snapshotCount += 1;
							return Effect.succeed(emptyRpcSessionSnapshot(0));
						},
					})
				);
				const keybindings = yield* settings.getCustomKeybindings();
				expect(keybindings).toEqual({
					"app.cached": "$mod+k",
				});
				expect(snapshotCount).toBe(0);
			})
		));

	it("falls back to the settings snapshot for custom keybindings", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(
					makeClient({
						snapshot: () =>
							Effect.succeed(
								withSettings(emptyRpcSessionSnapshot(0), [
									{
										key: "custom_keybindings",
										value: JSON.stringify({ "app.open": "$mod+o" }),
										sequence: 1,
									},
								])
							),
					})
				);
				const keybindings = yield* settings.getCustomKeybindings();
				expect(keybindings).toEqual({
					"app.open": "$mod+o",
				});
				expect(localStorageValues.get("acepe.custom_keybindings.hot_cache")).toBe(
					JSON.stringify({
						version: 1,
						keybindings: {
							"app.open": "$mod+o",
						},
					})
				);
			})
		));

	it("writes custom keybindings through settings.set", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: string[] = [];
				setAppRpcClientForTest(
					makeClient({
						dispatch: (command) => {
							dispatched.push(command.type);
							return Effect.succeed({ sequence: 1 });
						},
					})
				);
				const keybindings = {
					"app.save": "$mod+s",
				};
				const result = yield* Effect.result(settings.saveCustomKeybindings(keybindings));
				expect(Result.isSuccess(result)).toBe(true);
				expect(dispatched).toEqual(["settings.set"]);
				expect(localStorageValues.get("acepe.custom_keybindings.hot_cache")).toBe(
					JSON.stringify({
						version: 1,
						keybindings,
					})
				);
			})
		));

	it("loads thread list settings from the hot cache", () =>
		Effect.runPromise(
			Effect.gen(function* () {
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
				setAppRpcClientForTest(makeClient({}));
				const loaded = yield* settings.getThreadListSettings();
				expect(loaded).toEqual({
					hiddenProjects: ["/repo/cached"],
					archivedSessions: [
						{
							sessionId: "session-1",
							projectPath: "/repo/cached",
							agentId: "claude-code",
						},
					],
				});
			})
		));

	it("returns empty thread list settings when no cache exists", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const loaded = yield* settings.getThreadListSettings();
				expect(loaded).toEqual({
					hiddenProjects: [],
					archivedSessions: [],
				});
			})
		));

	it("mirrors saved thread list settings into the hot cache", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const threadListSettings = {
					hiddenProjects: ["/repo/new-hidden"],
					archivedSessions: [],
				};
				const result = yield* Effect.result(
					settings.saveThreadListSettings(threadListSettings)
				);
				expect(Result.isSuccess(result)).toBe(true);
				expect(localStorageValues.get("acepe.thread_list_settings.hot_cache")).toBe(
					JSON.stringify({
						version: 1,
						settings: threadListSettings,
					})
				);
			})
		));

	it("fails resetDatabase because it is not on the contract", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				setAppRpcClientForTest(makeClient({}));
				const result = yield* Effect.result(settings.resetDatabase());
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result) && result.failure instanceof AgentError) {
					expect(result.failure.operation).toBe("storage.reset_database");
				}
			})
		));
});
