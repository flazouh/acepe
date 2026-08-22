import { firstDivergence } from "@acepe/harness"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import { SessionProjectionSnapshot } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import { HistoryImportInput } from "../importer.ts"
import { CursorHistory } from "../Services/CursorHistory.ts"
import {
	HISTORY_TEST_NOW,
	HistoryEngineLive,
	HistoryPlatform,
	setHistoryClock
} from "../testLive.ts"
import { CursorHistoryLive } from "./CursorHistory.ts"

const encodeSnapshot = Schema.encodeUnknownEffect(SessionProjectionSnapshot)
const asJson = Schema.decodeUnknownEffect(Schema.Json)
const decodeInput = Schema.decodeUnknownEffect(HistoryImportInput)

const TestLive = CursorHistoryLive.pipe(
	Layer.provideMerge(ProjectionSnapshotQueryLive),
	Layer.provideMerge(HistoryEngineLive),
	Layer.provideMerge(HistoryPlatform)
)

const isolated = () => Layer.fresh(TestLive)

const oracle = {
	snapshotSequence: 4,
	session: {
		sessionId: "cursor-session",
		projectId: "project-1",
		title: "Hello from Cursor",
		provider: null,
		createdAt: HISTORY_TEST_NOW,
		updatedAt: HISTORY_TEST_NOW,
		lastActivityAt: HISTORY_TEST_NOW,
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null
	},
	messages: [
		{
			sessionId: "cursor-session",
			sequence: 3,
			messageId: "cursor-session:user:0",
			turnId: null,
			rowType: "user",
			content: { text: "Hello from Cursor" }
		},
		{
			sessionId: "cursor-session",
			sequence: 4,
			messageId: "cursor-session:assistant:0",
			turnId: null,
			rowType: "assistant",
			content: { text: "Hi there" }
		}
	],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints: [],
	projects: [],
	sessions: [],
	settings: []
}

Vitest.layer(isolated())("CursorHistoryLive", (it) => {
	it.effect("imports JSONL into projections and skips malformed lines", () =>
		Effect.gen(function*() {
			yield* setHistoryClock(HISTORY_TEST_NOW)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const history = yield* CursorHistory
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(
				path.join(dir, "cursor-session.jsonl"),
				[
					'{"role":"user","message":{"content":"Hello from Cursor"}}',
					"{",
					'{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}',
					""
				].join("\n")
			)
			const input = yield* decodeInput({
				root: dir,
				projectId: "project-1",
				workspaceRoot: "/tmp/acepe"
			})
			const imported = yield* history.importDirectory(input)
			Vitest.assert.strictEqual(imported.warnings.length, 1)
			Vitest.assert.strictEqual(imported.warnings[0]?._tag, "HistoryMalformedLineWarning")
			Vitest.assert.strictEqual(imported.snapshots.length, 1)
			const snapshot = imported.snapshots[0]
			if (snapshot === undefined) {
				Vitest.assert.fail("expected one projection snapshot")
				return
			}
			const encoded = yield* encodeSnapshot(snapshot)
			const actual = yield* asJson(encoded)
			const expected = yield* asJson(oracle)
			const divergence = firstDivergence(expected, actual, "snapshot")
			Vitest.assert.isTrue(
				Option.isNone(divergence),
				Option.match(divergence, {
					onNone: () => "",
					onSome: (value) => `${value.path}`
				})
			)
		})
	)
})
