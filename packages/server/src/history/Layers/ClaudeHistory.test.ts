import { firstDivergence } from "@acepe/harness"
import { CommandId, ProjectCreateCommand, ProjectId } from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
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
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
		providerSessionId: null
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
	checkpoints: [],
	projects: [],
	sessions: [],
	settings: [],
	skillsCatalog: null,
	voice: null,
	gitReview: null,
			mcpCatalog: null,
			preconnectionOptions: null,
			terminal: null,
			sessionReviewState: null,
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

	it.effect("importing the same session file twice does not duplicate orchestration events", () =>
		Effect.gen(function*() {
			yield* setHistoryClock(HISTORY_TEST_NOW)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const sql = yield* SqlClient.SqlClient
			const history = yield* ClaudeHistory
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "sess-claude-2.jsonl")
			yield* fs.writeFileString(
				filePath,
				[
					'{"type":"user","sessionId":"sess-claude-2","message":{"role":"user","content":"Hello twice"}}',
					'{"type":"assistant","sessionId":"sess-claude-2","message":{"role":"assistant","content":[{"type":"text","text":"Hi again"}]}}'
				].join("\n")
			)
			const input = yield* decodeInput({
				root: dir,
				projectId: "project-double-import",
				workspaceRoot: "/tmp/acepe-double-import"
			})

			const countEvents = () =>
				sql`SELECT COUNT(*) as count FROM orchestration_events`.withoutTransform.pipe(
					Effect.map((rows) => Number((rows[0] as { readonly count: number }).count))
				)

			const first = yield* history.importSessionFile(input, filePath)
			Vitest.assert.strictEqual(Option.isSome(first.sessionId), true)
			const countAfterFirst = yield* countEvents()
			Vitest.assert.isAbove(countAfterFirst, 0)

			const second = yield* history.importSessionFile(input, filePath)
			Vitest.assert.deepStrictEqual(second.sessionId, first.sessionId)
			const countAfterSecond = yield* countEvents()
			Vitest.assert.strictEqual(countAfterSecond, countAfterFirst)
		})
	)

	// Regression (#249 batch 3, caught live via electrobun-qa): when the
	// caller resolves an EXISTING project's id (importProviderSessionHandler
	// does this by workspaceRoot so a session import reuses the project the
	// user already added), ensureProject's own project.create dispatch
	// invariant-fails every time -- and OrchestrationCommandReceipts answers
	// every dispatch after the first of that same deterministic commandId
	// with OrchestrationCommandPreviouslyRejectedError, not the invariant
	// error the plain swallow used to check for. Without also swallowing
	// that, importSessionFile only worked once per pre-existing project.
	it.effect("imports into an already-existing project on every call, not just the first", () =>
		Effect.gen(function*() {
			yield* setHistoryClock(HISTORY_TEST_NOW)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const engine = yield* OrchestrationEngine
			const history = yield* ClaudeHistory
			const dir = yield* fs.makeTempDirectoryScoped()
			const filePath = path.join(dir, "sess-claude-3.jsonl")
			yield* fs.writeFileString(
				filePath,
				'{"type":"user","sessionId":"sess-claude-3","message":{"role":"user","content":"Hello from an existing project"}}'
			)
			const projectId = ProjectId.make("project-preexisting")
			// Simulate the project already having been added through the
			// normal "add repository" flow, under a commandId importSessionFile
			// never uses itself.
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("manual-add-repository"),
					projectId,
					title: "Manually Added",
					workspaceRoot: "/tmp/acepe-preexisting"
				})
			)
			const input = yield* decodeInput({
				root: dir,
				projectId: "project-preexisting",
				workspaceRoot: "/tmp/acepe-preexisting"
			})

			const first = yield* history.importSessionFile(input, filePath)
			Vitest.assert.strictEqual(Option.isSome(first.sessionId), true)

			// The regression: a second importSessionFile call against the same
			// pre-existing project must still succeed, not fail on the
			// project.create receipt from the first call's invariant rejection.
			const second = yield* history.importSessionFile(input, filePath)
			Vitest.assert.deepStrictEqual(second.sessionId, first.sessionId)
		})
	)
})
