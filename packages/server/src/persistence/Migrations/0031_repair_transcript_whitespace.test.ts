import {
	assistantReplyText,
	CommandId,
	EventId,
	MessageId,
	SessionId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationCommandReceiptsLive } from "../Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "../Layers/OrchestrationEventStore.ts"
import { ProjectionSessionMessagesLive } from "../Layers/ProjectionSessionMessages.ts"
import { ProjectionStateLive } from "../Layers/ProjectionState.ts"
import { makeSqliteLayer } from "../Layers/Sqlite.ts"
import {
	type NewOrchestrationEvent,
	OrchestrationEventStore
} from "../Services/OrchestrationEventStore.ts"
import {
	PROJECTION_SESSION_MESSAGES_NAME,
	ProjectionSessionMessages
} from "../Services/ProjectionSessionMessages.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import { ProjectionApplyError } from "../../orchestration/Services/ProjectionPipeline.ts"
import { runMigrations } from "../Migrations.ts"
import repairTranscriptWhitespace from "./0031_repair_transcript_whitespace.ts"

const occurredAt = "2026-08-20T12:00:00.000Z"
const sessionId = SessionId.make("session-1")
const assistantMessageId = MessageId.make("message-assistant")
const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

// The exact shape of the live defect: the provider streamed a token ending in
// a space, and the pre-fix fold trimmed it back off before the next token
// arrived.
const TOKENS = ["I'll run ", "all three steps."]
const CORRUPTED_TEXT = "I'll runall three steps."
const REPAIRED_TEXT = "I'll run all three steps."

const tokenAppended = (index: number, token: string): NewOrchestrationEvent => ({
	eventId: EventId.make(`event-${index}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt,
	commandId: CommandId.make(`cmd-${index}`),
	causationEventId: null,
	correlationId: CommandId.make(`cmd-${index}`),
	metadata: {},
	type: "TokenAppended",
	payload: {
		sessionId,
		messageId: assistantMessageId,
		token
	}
})

const TempSqlite = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const dir = yield* fs.makeTempDirectoryScoped()
		return makeSqliteLayer({
			filename: path.join(dir, "acepe-test.db"),
			readonly: false
		})
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const MigratedSqlite = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(TempSqlite))

const PersistenceLive = Layer.mergeAll(
	OrchestrationEventStoreLive,
	OrchestrationCommandReceiptsLive,
	ProjectionStateLive,
	ProjectionSessionMessagesLive
).pipe(Layer.provideMerge(MigratedSqlite))

const EngineLive = OrchestrationEngineLive.pipe(
	Layer.provideMerge(PersistenceLive),
	Layer.provide(BunCrypto.layer)
)

const isolatedEngine = () => Layer.fresh(EngineLive)

// Puts the database into the state a pre-fix install boots with: the tokens
// are all still in the event log, and the projected row holds the text the
// trimming fold produced from them, checkpointed as fully applied.
const seedCorruptedInstall = Effect.fn("seedCorruptedInstall")(function*() {
	const sql = yield* SqlClient.SqlClient
	const store = yield* OrchestrationEventStore
	const state = yield* ProjectionState
	const lastSequence = yield* store.append(
		TOKENS.map((token, index) => tokenAppended(index + 1, token))
	)
	// The literal JSON a pre-fix install actually holds: the legacy flat-text
	// shape, written before assistant content became an ordered parts array.
	// Seeding it verbatim also exercises the versioned decode that lifts a
	// legacy row into a single text part.
	const content = Schema.encodeSync(Schema.fromJsonString(Schema.Struct({ text: Schema.String })))(
		{ text: CORRUPTED_TEXT }
	)
	yield* sql`
		INSERT INTO projection_session_messages (
			session_id,
			sequence,
			message_id,
			turn_id,
			row_type,
			content,
			last_sequence
		) VALUES (
			${sessionId},
			1,
			${assistantMessageId},
			${null},
			'assistant',
			${content},
			${lastSequence}
		)
	`.withoutTransform
	yield* state.checkpoint(PROJECTION_SESSION_MESSAGES_NAME, lastSequence)
	return lastSequence
})

const readAssistantText = Effect.fn("readAssistantText")(function*() {
	const messages = yield* ProjectionSessionMessages
	const listed = yield* messages.listBySession(sessionId)
	const row = listed[0]
	if (row === undefined || row.rowType !== "assistant") {
		return null
	}
	return assistantReplyText(row.content)
})

const waitForSequence = Effect.fn("waitForSequence")(function*(
	name: string,
	sequence: number
) {
	const state = yield* ProjectionState
	let spins = 0
	while (true) {
		const current = yield* state.lastApplied(name)
		if (current === sequence) {
			return
		}
		spins = spins + 1
		if (spins > 200) {
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

Vitest.layer(isolatedEngine())("0031 clears the corrupted projection", (it) => {
	it.effect("removes every projected message row and the projector checkpoint", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const state = yield* ProjectionState
			const lastSequence = yield* seedCorruptedInstall()
			Vitest.assert.strictEqual(yield* readAssistantText(), CORRUPTED_TEXT)
			Vitest.assert.strictEqual(
				yield* state.lastApplied(PROJECTION_SESSION_MESSAGES_NAME),
				lastSequence
			)
			yield* repairTranscriptWhitespace
			const remaining = yield* sql<{ count: number }>`
				SELECT COUNT(*) AS count FROM projection_session_messages
			`.withoutTransform
			Vitest.assert.strictEqual(Number(remaining[0]?.count), 0)
			Vitest.assert.strictEqual(
				yield* state.lastApplied(PROJECTION_SESSION_MESSAGES_NAME),
				0
			)
		})
	)
})

// The whole repair, end to end: a database holding the corrupted row boots,
// the migration clears the projection, and the pipeline's own catch-up folds
// the tokens back out of the event log with their whitespace intact.
Vitest.layer(isolatedEngine())("0031 then replay repairs the text", (it) => {
	it.effect("rebuilds the assistant row with the whitespace the provider streamed", () =>
		Effect.gen(function*() {
			const messages = yield* ProjectionSessionMessages
			const name = yield* decodeName(PROJECTION_SESSION_MESSAGES_NAME)
			const lastSequence = yield* seedCorruptedInstall()
			yield* repairTranscriptWhitespace
			yield* Effect.scoped(
				Effect.gen(function*() {
					yield* waitForSequence(name, lastSequence)
					Vitest.assert.strictEqual(yield* readAssistantText(), REPAIRED_TEXT)
				}).pipe(
					// @effect-diagnostics-next-line strictEffectProvide:off
					Effect.provide(
						Layer.fresh(
							ProjectionPipelineLive([
								{
									name,
									apply: messages.apply,
									truncate: messages.truncate
								}
							])
						)
					)
				)
			)
		})
	)
})
