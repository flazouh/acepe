import { firstDivergence } from "@acepe/harness"
import {
	CommandId,
	EventId,
	ProjectCreateCommand,
	ProjectId,
	Sequence,
	SessionCreateCommand,
	SessionId,
	SessionMetaUpdatedEvent
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import { ProjectionSessions } from "../../persistence/Services/ProjectionSessions.ts"
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
		// #268 defect 1: importDirectory must carry the real providerId so
		// HardcodedProvider's tracer never claims an imported session (see
		// HISTORY_PROVIDER_ADAPTER_ID in importer.ts).
		provider: "claude-code",
		createdAt: HISTORY_TEST_NOW,
		updatedAt: HISTORY_TEST_NOW,
		lastActivityAt: HISTORY_TEST_NOW,
		archivedAt: null,
		deletedAt: null,
		prNumber: null,
		prLinkMode: null,
		providerSessionId: null,
		providerSessionFailed: false,
		// An imported session is a thread the user had; never an ephemeral one.
		ephemeral: false,
		// An imported session never carries a SessionModeSet, so the canonical
		// mode is absent and the provider's opening mode stands.
		currentModeId: null,
		// Nor a session_models fact: history parsing restores transcript
		// content, and only a live provider can be asked for its catalog.
		currentModelId: null,
		availableModels: null,
		// Nor a SessionConfigOptionSet: no config option was ever chosen, so the
		// provider catalog's own defaults stand.
		configOptions: null
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
			content: { parts: [{ kind: "text", text: "Hi there" }] }
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

	// Reload-loses-pending-approval root cause (live repro 2026-08-31): a
	// session created live in Acepe keeps its orchestration aggregate id
	// (session-session-create-*) and claims the provider's on-disk JSONL uuid
	// via SessionMetaUpdated metadata (provider_session contract fact).
	// Importing that same JSONL used to CREATE A SECOND session aggregate
	// keyed by the uuid — a twin with messages only, no activities and no
	// pending approvals — and the reopen path then hydrated the twin, so a
	// still-unanswered approval vanished from the UI. The importer must
	// resolve the uuid to the claiming session instead of forking.
	it.effect("resolves a JSONL uuid claimed by a live session instead of forking a twin", () =>
		Effect.gen(function*() {
			yield* setHistoryClock(HISTORY_TEST_NOW)
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const sql = yield* SqlClient.SqlClient
			const engine = yield* OrchestrationEngine
			const history = yield* ClaudeHistory
			const dir = yield* fs.makeTempDirectoryScoped()
			const providerUuid = "sess-claude-4"
			const liveSessionId = SessionId.make("session-session-create-claimed-1")
			const projectId = ProjectId.make("project-claimed")
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("manual-add-repository-claimed"),
					projectId,
					title: "Claimed",
					workspaceRoot: "/tmp/acepe-claimed"
				})
			)
			yield* engine.dispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("live-session-create-claimed"),
					sessionId: liveSessionId,
					projectId,
					title: "Live session",
					providerId: "claude-code"
				})
			)
			// The same provider_session contract fact ProviderBridge appends when
			// the real adapter learns its on-disk session uuid.
			yield* engine.appendEvents([
				SessionMetaUpdatedEvent.make({
					sequence: Sequence.make(0),
					eventId: EventId.make(`event-${liveSessionId}-provider-session`),
					aggregateKind: "session",
					aggregateId: liveSessionId,
					occurredAt: HISTORY_TEST_NOW,
					commandId: CommandId.make("live-session-meta-claimed"),
					causationEventId: null,
					correlationId: CommandId.make("live-session-meta-claimed"),
					metadata: {
						contractKind: "provider_session",
						providerSessionId: providerUuid
					},
					type: "SessionMetaUpdated",
					payload: { sessionId: liveSessionId }
				})
			])
			// The engine does not project; production runs a projector loop. Fold
			// the live session's events into projection_sessions the same way the
			// importer's own applyImportedEvents does, so provider_session_id is
			// visible to the lookup under test.
			const store = yield* OrchestrationEventStore
			const sessions = yield* ProjectionSessions
			const events = yield* Stream.runCollect(store.readFrom(Sequence.make(0), 1000))
			yield* sql.withTransaction(
				Effect.forEach(events, (event) => sessions.apply(event, sql), { discard: true })
			)
			const filePath = path.join(dir, `${providerUuid}.jsonl`)
			yield* fs.writeFileString(
				filePath,
				[
					`{"type":"user","sessionId":"${providerUuid}","message":{"role":"user","content":"Prompt that is already canonical"}}`,
					`{"type":"assistant","sessionId":"${providerUuid}","message":{"role":"assistant","content":[{"type":"text","text":"Reply that is already canonical"}]}}`
				].join("\n")
			)
			const input = yield* decodeInput({
				root: dir,
				projectId: "project-claimed",
				workspaceRoot: "/tmp/acepe-claimed"
			})

			const imported = yield* history.importSessionFile(input, filePath)
			Vitest.assert.deepStrictEqual(imported.sessionId, Option.some(liveSessionId))

			const twinRows = yield* sql`
				SELECT session_id FROM projection_sessions WHERE session_id = ${providerUuid}
			`.withoutTransform
			Vitest.assert.strictEqual(twinRows.length, 0, "importer forked a twin session aggregate")
			const twinEvents = yield* sql`
				SELECT sequence FROM orchestration_events WHERE aggregate_id = ${providerUuid}
			`.withoutTransform
			Vitest.assert.strictEqual(twinEvents.length, 0, "importer committed events for the twin")
		})
	)
})
