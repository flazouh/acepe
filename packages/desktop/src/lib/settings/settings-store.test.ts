import { describe, expect, it } from "bun:test";
import {
	APP_SETTINGS_ID,
	CommandId,
	emptyRpcSessionSnapshot,
	EventId,
	ProjectId,
	type RpcClient,
	type RpcSessionSnapshot,
	settingsSnapshotRequest,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { uiFontSizeFromSettings } from "./settings-font.ts";
import {
	composeSettingsStore,
	isSettingsProjectionEvent,
} from "./settings-store.ts";

const occurredAt = "2026-08-20T12:00:00.000Z";
const commandId = CommandId.make("cmd-1");

const settingsSnapshot: RpcSessionSnapshot = {
	snapshotSequence: 4,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints: [],
	projects: [],
	sessions: [],
	settings: [
		{ key: "ui_font_size", value: "18", sequence: 3 },
		{ key: "code_font_size", value: "15", sequence: 4 },
	],
	skillsCatalog: null,
	voice: null,
	gitReview: null,
			mcpCatalog: null,
			preconnectionOptions: null,
};

describe("isSettingsProjectionEvent", () => {
	it("treats SettingsUpdated as a settings fact", () => {
		expect(
			isSettingsProjectionEvent({
				sequence: 2,
				eventId: EventId.make("event-2"),
				aggregateKind: "settings",
				aggregateId: APP_SETTINGS_ID,
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "SettingsUpdated",
				payload: {
					key: "ui_font_size",
					value: "18",
				},
			}),
		).toBe(true);
		expect(
			isSettingsProjectionEvent({
				sequence: 3,
				eventId: EventId.make("event-3"),
				aggregateKind: "project",
				aggregateId: ProjectId.make("project-1"),
				occurredAt,
				commandId,
				causationEventId: null,
				correlationId: commandId,
				metadata: {},
				type: "ProjectCreated",
				payload: {
					projectId: ProjectId.make("project-1"),
					title: "Acepe",
					workspaceRoot: "/tmp/acepe",
				},
			}),
		).toBe(false);
	});
});

describe("composeSettingsStore", () => {
	it("loads settings through snapshot, not a fourth RPC", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requested: Array<unknown> = [];
				const dispatched: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: (command) => {
						dispatched.push(command);
						return Effect.succeed({ sequence: 5 });
					},
					snapshot: (request) => {
						requested.push(request);
						return Effect.succeed(settingsSnapshot);
					},
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const seen: Array<number> = [];
				const store = composeSettingsStore({
					client,
					nextCommandId: () => CommandId.make("cmd-settings-1"),
					onSnapshot: (snapshot) => {
						seen.push(snapshot.settings[0]?.sequence ?? 0);
					},
				});
				expect(store.readSnapshot()).toEqual(emptyRpcSessionSnapshot(0));
				yield* store.openSettings();
				expect(requested).toEqual([settingsSnapshotRequest()]);
				expect(store.readSnapshot().settings[0]?.value).toBe("18");
				expect(seen).toEqual([3]);
				yield* store.setUiFontSize(19);
				expect(requested).toEqual([settingsSnapshotRequest(), settingsSnapshotRequest()]);
				expect(dispatched).toEqual([
					{
						type: "settings.set",
						commandId: CommandId.make("cmd-settings-1"),
						key: "ui_font_size",
						value: "19",
					},
				]);
			}),
		));

	it("applies SettingsUpdated from the events primitive", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 5 }),
					snapshot: () => Effect.succeed(settingsSnapshot),
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () =>
						Stream.make({
							sequence: 5,
							eventId: EventId.make("event-5"),
							aggregateKind: "settings",
							aggregateId: APP_SETTINGS_ID,
							occurredAt,
							commandId,
							causationEventId: null,
							correlationId: commandId,
							metadata: {},
							type: "SettingsUpdated",
							payload: {
								key: "ui_font_size",
								value: "19",
							},
						}),
				};
				const store = composeSettingsStore({ client });
				yield* store.openSettings();
				const rows = store.readSnapshot().settings;
				expect(rows).toEqual([
					{ key: "code_font_size", value: "15", sequence: 4 },
					{ key: "ui_font_size", value: "19", sequence: 5 },
				]);
			}),
		));

	it("bumps interface font size through settings.set", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: (command) => {
						dispatched.push(command);
						return Effect.succeed({ sequence: 6 });
					},
					snapshot: () => Effect.succeed(settingsSnapshot),
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const store = composeSettingsStore({
					client,
					nextCommandId: () => CommandId.make("cmd-settings-bump"),
				});
				yield* store.openSettings();
				yield* store.bumpUiFontSize(1);
				yield* store.bumpCodeFontSize(-1);
				expect(dispatched).toEqual([
					{
						type: "settings.set",
						commandId: CommandId.make("cmd-settings-bump"),
						key: "ui_font_size",
						value: "19",
					},
					{
						type: "settings.set",
						commandId: CommandId.make("cmd-settings-bump"),
						key: "code_font_size",
						value: "14",
					},
				]);
			}),
		));

	it("steps interface font twice when the snapshot read still returns the old size", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<string> = [];
				const client: RpcClient = {
					dispatch: (command) => {
						if (command.type === "settings.set") {
							dispatched.push(command.value);
						}
						return Effect.succeed({ sequence: 6 });
					},
					snapshot: () => Effect.succeed(emptyRpcSessionSnapshot(4)),
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const store = composeSettingsStore({
					client,
					nextCommandId: () => CommandId.make("cmd-settings-stale-snap"),
				});
				yield* store.openSettings();
				yield* store.bumpUiFontSize(1);
				yield* store.bumpUiFontSize(1);
				expect(dispatched).toEqual(["17", "18"]);
			}),
		));

	it("does not let an older snapshot read replace a newer projected setting", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				let snapshotCalls = 0;
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 12 }),
					snapshot: () => {
						snapshotCalls += 1;
						if (snapshotCalls === 1) {
							return Effect.succeed(settingsSnapshot);
						}
						return Effect.succeed({
							snapshotSequence: 2,
							session: null,
							messages: [],
							turns: [],
							activities: [],
							pendingApprovals: [],
							checkpoints: [],
							projects: [],
							sessions: [],
							settings: [{ key: "ui_font_size", value: "16", sequence: 2 }],
							skillsCatalog: null,
							voice: null,
							gitReview: null,
			mcpCatalog: null,
			preconnectionOptions: null,
						});
					},
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () =>
						Stream.make({
							sequence: 5,
							eventId: EventId.make("event-5"),
							aggregateKind: "settings",
							aggregateId: APP_SETTINGS_ID,
							occurredAt,
							commandId,
							causationEventId: null,
							correlationId: commandId,
							metadata: {},
							type: "SettingsUpdated",
							payload: {
								key: "ui_font_size",
								value: "19",
							},
						}),
				};
				const store = composeSettingsStore({
					client,
					nextCommandId: () => CommandId.make("cmd-settings-monotonic"),
				});
				yield* store.openSettings();
				expect(uiFontSizeFromSettings(store.readSnapshot().settings)).toBe(19);
				yield* store.setUiFontSize(20);
				expect(uiFontSizeFromSettings(store.readSnapshot().settings)).toBe(19);
			}),
		));

	it("allocates a command id that cannot replay a previous process settings-set-1 receipt", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const dispatched: Array<CommandId> = [];
				const client: RpcClient = {
					dispatch: (command) => {
						if (command.type === "settings.set") {
							dispatched.push(command.commandId);
						}
						return Effect.succeed({ sequence: 6 });
					},
					snapshot: () => Effect.succeed(settingsSnapshot),
					getProjectIndex: () =>
						Effect.succeed({
							projectPath: "/tmp/acepe",
							files: [],
							gitStatus: [],
							totalFiles: 0,
							totalLines: 0,
						}),
					invalidateProjectIndex: () => Effect.void,
					events: () => Stream.empty,
				};
				const store = composeSettingsStore({ client });
				yield* store.openSettings();
				yield* store.setUiFontSize(17);
				yield* store.setUiFontSize(18);
				expect(dispatched[0]).not.toBe(CommandId.make("settings-set-1"));
				expect(dispatched[1]).not.toBe(dispatched[0]);
				expect(String(dispatched[0])).toMatch(/^settings-set-\d+-\d+$/);
			}),
		));
});
