import { describe, expect, it } from "bun:test";
import {
	emptyRpcSessionSnapshot,
	settingsSnapshotRequest,
	type RpcClient,
	type RpcSessionSnapshot,
} from "@acepe/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { settingsModalViewModel } from "../../settings/settings-state.ts";
import { composeSettingsStore } from "../../settings/settings-store.ts";

const snapshot: RpcSessionSnapshot = {
	snapshotSequence: 2,
	session: null,
	messages: [],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints: [],
	projects: [],
	sessions: [],
	settings: [
		{ key: "ui_font_size", value: "18", sequence: 1 },
		{ key: "code_font_size", value: "15", sequence: 2 },
	],
	skillsCatalog: null,
	voice: null,
};

describe("settings view controller mapping", () => {
	it("maps a settings snapshot onto modal props after openSettings", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const requested: Array<unknown> = [];
				const client: RpcClient = {
					dispatch: () => Effect.succeed({ sequence: 1 }),
					snapshot: (request) => {
						requested.push(request);
						return Effect.succeed(snapshot);
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
				const store = composeSettingsStore({ client });
				yield* store.openSettings();
				const model = settingsModalViewModel({
					snapshot: store.readSnapshot(),
					open: true,
				});
				expect(requested).toEqual([settingsSnapshotRequest()]);
				expect(model.uiFontSize).toBe(18);
				expect(model.codeFontSize).toBe(15);
				expect(model.open).toBe(true);
				expect(emptyRpcSessionSnapshot(0).settings).toEqual([]);
			}),
		));
});
