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
import { ClaudeHistory } from "../Services/ClaudeHistory.ts"
import {
	HISTORY_TEST_NOW,
	HistoryEngineLive,
	HistoryPlatform,
	setHistoryClock
} from "../testLive.ts"
import { ClaudeHistoryLive } from "./ClaudeHistory.ts"

const encodeSnapshot = Schema.encodeUnknownEffect(SessionProjectionSnapshot)
const asJson = Schema.decodeUnknownEffect(Schema.Json)
const decodeInput = Schema.decodeUnknownEffect(HistoryImportInput)

const TestLive = ClaudeHistoryLive.pipe(
	Layer.provideMerge(ProjectionSnapshotQueryLive),
	Layer.provideMerge(HistoryEngineLive),
	Layer.provideMerge(HistoryPlatform)
)

const isolated = () => Layer.fresh(TestLive)

const oracle = {
	snapshotSequence: 4,
	session: {
		sessionId: "sess-claude-1",
		projectId: "project-1",
		title: "Hello from Claude",
		provider: null,
		createdAt: HISTORY_TEST_NOW,
		updatedAt: HISTORY_TEST_NOW,
		lastActivityAt: HISTORY_TEST_NOW,
		archivedAt: null,
		deletedAt: null
	},
	messages: [
		{
			sessionId: "sess-claude-1",
			sequence: 3,
			messageId: "sess-claude-1:user:0",
			turnId: null,
			rowType: "user",
			content: { text: "Hello from Claude" }
		},
		{
			sessionId: "sess-claude-1",
			sequence: 4,
			messageId: "sess-claude-1:assistant:0",
			turnId: null,
			rowType: "assistant",
			content: { text: "Hi there" }
		}
	],
	turns: [],
	activities: [],
	pendingApprovals: [],
	checkpoints: []
}

Vitest.layer(isolated())("ClaudeHistoryLive", (it) => {
	it.effect("imports JSONL into projections and skips malformed lines", () =>
		Effect.gen(function*() {
			yield* setHistoryClock(HISTORY_TEST_NOW)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const history = yield* ClaudeHistory
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(
				path.join(dir, "sess-claude-1.jsonl"),
				[
					'{"type":"user","sessionId":"sess-claude-1","message":{"role":"user","content":"Hello from Claude"}}',
					"this line is not json",
					'{"type":"assistant","sessionId":"sess-claude-1","message":{"role":"assistant","content":[{"type":"text","text":"Hi there"}]}}',
					'{"type":"file-history-snapshot"}',
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
			Vitest.assert.strictEqual(imported.warnings[0]?.lineNumber, 2)
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
