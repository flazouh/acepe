import {
	ActivityId,
	CommandId,
	EventId,
	IsoDateTime,
	type OrchestrationEvent,
	ProjectId,
	Sequence,
	SessionId,
	ToolCallId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import {
	loadFixture,
	referenceFixturePath,
	type RecordedExchange
} from "@acepe/harness"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { OrchestrationEngineLive } from "../../orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts"
import { ProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts"
import {
	type ProjectorDefinition,
	ProjectionApplyError,
	ProjectionPipeline
} from "../../orchestration/Services/ProjectionPipeline.ts"
import {
	OrchestrationEngine,
	OrchestrationEngineShutdownError
} from "../../orchestration/Services/OrchestrationEngine.ts"
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts"
import { runMigrations } from "../Migrations.ts"
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts"
import {
	activityKindFromTool,
	type ActivityProjectionEvent,
	OperationId,
	PROJECTION_SESSION_ACTIVITIES_NAME,
	ProjectionSessionActivities,
	type ProjectionSessionActivitiesShape,
	SessionActivityStatus,
	type SessionActivityEvent
} from "../Services/ProjectionSessionActivities.ts"
import { ProjectionState } from "../Services/ProjectionState.ts"
import { ProjectionSessionActivitiesLive } from "./ProjectionSessionActivities.ts"
import { ProjectionStateLive } from "./ProjectionState.ts"
import { makeSqliteLayer } from "./Sqlite.ts"

const NOW = "2026-08-20T12:00:00.000Z"
const commandId = CommandId.make("cmd-1")
const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const otherSessionId = SessionId.make("session-2")
const activityId = ActivityId.make("activity-1")
const otherActivityId = ActivityId.make("activity-2")
const toolCallId = ToolCallId.make("toolu_01TestToolCall0000000001")
const operationId = OperationId.make("op-1")

const DumpRow = Schema.Struct({
	activity_id: Schema.String,
	session_id: Schema.String,
	sequence: Sequence,
	status_sequence: Sequence,
	kind: Schema.String,
	tool_call_id: Schema.NullOr(Schema.String),
	operation_id: Schema.NullOr(Schema.String),
	status: Schema.String,
	title: Schema.String,
	path: Schema.NullOr(Schema.String)
})
const decodeDumpRows = Schema.decodeUnknownEffect(Schema.Array(DumpRow))

const ToolRawInput = Schema.Struct({
	file_path: Schema.optionalKey(TrimmedNonEmptyString)
})

const AcpToolCallPayload = Schema.Struct({
	type: Schema.Literal("tool_call"),
	toolCallId: ToolCallId,
	title: TrimmedNonEmptyString,
	kind: TrimmedNonEmptyString,
	status: SessionActivityStatus,
	rawInput: Schema.optionalKey(ToolRawInput)
})

const AcpSessionUpdateNotification = Schema.Struct({
	method: Schema.String,
	params: Schema.Struct({
		sessionId: SessionId,
		seq: Sequence,
		payload: AcpToolCallPayload
	})
})

const decodeToolCallNotification = Schema.decodeUnknownEffect(AcpSessionUpdateNotification)

const toolObserved = (
	id: ActivityId,
	sequence: number,
	session: SessionId,
	status: typeof SessionActivityStatus.Type,
	title: TrimmedNonEmptyString
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: session,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ToolCallObserved",
	payload: {
		sessionId: session,
		activityId: id,
		toolCallId,
		operationId: null,
		status,
		title
	}
})

const fileObserved = (
	sequence: number,
	status: typeof SessionActivityStatus.Type
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "FileOperationObserved",
	payload: {
		sessionId,
		activityId,
		toolCallId,
		operationId: null,
		status,
		title: "Read",
		path: "/tmp/file.ts"
	}
})

const statusAdvanced = (
	sequence: number,
	status: typeof SessionActivityStatus.Type
): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ActivityStatusAdvanced",
	payload: {
		sessionId,
		activityId,
		status
	}
})

const operationLinked = (sequence: number): SessionActivityEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "session",
	aggregateId: sessionId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ActivityOperationLinked",
	payload: {
		sessionId,
		activityId,
		operationId
	}
})

const projectCreated = (sequence: number): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: NOW,
	commandId,
	causationEventId: null,
	correlationId: commandId,
	metadata: {},
	type: "ProjectCreated",
	payload: {
		projectId,
		title: "Acepe",
		workspaceRoot: "/tmp/acepe"
	}
})

const seedLog: ReadonlyArray<SessionActivityEvent> = [
	fileObserved(2, "pending"),
	statusAdvanced(3, "completed"),
	toolObserved(otherActivityId, 4, sessionId, "pending", "Bash"),
	operationLinked(5)
]

const toPipelineEvent = (event: SessionActivityEvent): OrchestrationEvent =>
	event as never as OrchestrationEvent

const SeededStore = (events: ReadonlyArray<SessionActivityEvent>) =>
	Layer.succeed(
		OrchestrationEventStore,
		OrchestrationEventStore.of({
			append: () => Effect.succeed(0),
			readFrom: (sequence, limit) => {
				const newer = Arr.filter(events, (event) => event.sequence > sequence)
				const page = Arr.take(newer, limit)
				return Stream.fromIterable(Arr.map(page, toPipelineEvent))
			}
		})
	)

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

const ActivitiesLive = ProjectionSessionActivitiesLive.pipe(Layer.provideMerge(MigratedSqlite))

const isolatedActivities = () => Layer.fresh(ActivitiesLive)

const GradeLive = Layer.mergeAll(
	ProjectionSessionActivitiesLive,
	ProjectionSnapshotQueryLive,
	BunFileSystem.layer,
	BunPath.layer
).pipe(Layer.provideMerge(MigratedSqlite))

const isolatedGrade = () => Layer.fresh(GradeLive)

const IdleEngine = Layer.succeed(
	OrchestrationEngine,
	OrchestrationEngine.of({
		dispatch: () => Effect.fail(new OrchestrationEngineShutdownError()),
		streamDomainEvents: Stream.empty,
		latestSequence: Effect.succeed(0)
	})
)

const PersistenceLive = Layer.mergeAll(
	SeededStore(seedLog),
	IdleEngine,
	ProjectionStateLive,
	ProjectionSessionActivitiesLive
).pipe(Layer.provideMerge(MigratedSqlite))

const isolatedEngine = () => Layer.fresh(PersistenceLive)

const dumpTable = Effect.fn("dumpProjectionSessionActivities")(function*() {
	const sql = yield* SqlClient.SqlClient
	const rows = yield* sql`
		SELECT
			activity_id,
			session_id,
			sequence,
			status_sequence,
			kind,
			tool_call_id,
			operation_id,
			status,
			title,
			path
		FROM projection_session_activities
		ORDER BY sequence ASC, activity_id ASC
	`.withoutTransform
	return yield* decodeDumpRows(rows)
})

const projectorOf = (activities: {
	readonly name: ProjectorDefinition["name"]
	readonly apply: ProjectionSessionActivitiesShape["apply"]
	readonly truncate: ProjectorDefinition["truncate"]
}): ProjectorDefinition => ({
	name: activities.name,
	apply: (event, tx) => activities.apply(event, tx),
	truncate: activities.truncate
})

const withPipeline = <A, E, R>(
	projectors: ReadonlyArray<ProjectorDefinition>,
	body: Effect.Effect<A, E, R>
) =>
	Effect.scoped(
		body.pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(Layer.fresh(ProjectionPipelineLive(projectors)))
		)
	)

const waitForSequence = Effect.fn("waitForSequence")(function*(name: string, sequence: number) {
	const state = yield* ProjectionState
	const pipeline = yield* ProjectionPipeline
	let spins = 0
	while (true) {
		const current = yield* state.lastApplied(name)
		if (current === sequence) {
			return
		}
		spins = spins + 1
		if (spins > 200) {
			const health = yield* pipeline.health(name)
			return yield* new ProjectionApplyError({
				name,
				detail: `Timed out waiting for sequence ${sequence}; lastApplied=${current}; health=${health}.`
			})
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
})

const applyEvent = (
	activities: ProjectionSessionActivitiesShape,
	event: ActivityProjectionEvent
) =>
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		yield* activities.apply(event, sql)
	})

const checkpoint = Effect.fn("checkpoint")(function*(name: string, sequence: number) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_state (name, last_applied_sequence)
		VALUES (${name}, ${sequence})
		ON CONFLICT(name) DO UPDATE SET
			last_applied_sequence = excluded.last_applied_sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

const filePathFromRawInput = (
	rawInput: { readonly file_path?: TrimmedNonEmptyString } | undefined
): TrimmedNonEmptyString | null => {
	if (rawInput === undefined) {
		return null
	}
	if (rawInput.file_path === undefined) {
		return null
	}
	return rawInput.file_path
}

const eventFromToolCallNotification = (
	notification: typeof AcpSessionUpdateNotification.Type,
	occurredAt: IsoDateTime
): SessionActivityEvent => {
	const payload = notification.params.payload
	const path = filePathFromRawInput(payload.rawInput)
	const kind = activityKindFromTool(payload.kind, path)
	const activity = ActivityId.make(payload.toolCallId)
	if (kind === "file" && path !== null) {
		return {
			sequence: notification.params.seq,
			eventId: EventId.make(`fixture-${notification.params.seq}`),
			aggregateKind: "session",
			aggregateId: notification.params.sessionId,
			occurredAt,
			commandId: CommandId.make(`fixture-cmd-${notification.params.seq}`),
			causationEventId: null,
			correlationId: CommandId.make(`fixture-cmd-${notification.params.seq}`),
			metadata: {},
			type: "FileOperationObserved",
			payload: {
				sessionId: notification.params.sessionId,
				activityId: activity,
				toolCallId: payload.toolCallId,
				operationId: null,
				status: payload.status,
				title: payload.title,
				path
			}
		}
	}
	return {
		sequence: notification.params.seq,
		eventId: EventId.make(`fixture-${notification.params.seq}`),
		aggregateKind: "session",
		aggregateId: notification.params.sessionId,
		occurredAt,
		commandId: CommandId.make(`fixture-cmd-${notification.params.seq}`),
		causationEventId: null,
		correlationId: CommandId.make(`fixture-cmd-${notification.params.seq}`),
		metadata: {},
		type: "ToolCallObserved",
		payload: {
			sessionId: notification.params.sessionId,
			activityId: activity,
			toolCallId: payload.toolCallId,
			operationId: null,
			status: payload.status,
			title: payload.title
		}
	}
}

const activityEventsFromFixture = Effect.fn("activityEventsFromFixture")(function*(
	exchanges: ReadonlyArray<RecordedExchange>
) {
	const nested = yield* Effect.forEach(exchanges, (exchange) =>
		Effect.forEach(exchange.notifications, (notification) =>
			decodeToolCallNotification(notification).pipe(
				Effect.map((decoded) =>
					Option.some(eventFromToolCallNotification(decoded, exchange.recordedAt))
				),
				Effect.catchTag("SchemaError", () => Effect.succeed(Option.none<SessionActivityEvent>()))
			)
		)
	)
	const flattened = Arr.flatten(nested)
	const present = Arr.filter(flattened, Option.isSome)
	return Arr.map(present, (event) => event.value)
})

Vitest.layer(isolatedActivities())("apply ToolCallObserved", (it) => {
	it.effect("stores a tool row with a pending operation link", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, toolObserved(activityId, 3, sessionId, "pending", "Bash"))
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.strictEqual(listed.length, 1)
			Vitest.assert.strictEqual(listed[0]?.kind, "tool")
			Vitest.assert.strictEqual(listed[0]?.operationId, null)
			Vitest.assert.strictEqual(listed[0]?.status, "pending")
			Vitest.assert.strictEqual(listed[0]?.title, "Bash")
		})
	)
})

Vitest.layer(isolatedActivities())("apply ignores v1 events", (it) => {
	it.effect("does not insert a ProjectCreated event", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, projectCreated(1))
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [])
		})
	)
})

Vitest.layer(isolatedActivities())("pending link then operation", (it) => {
	it.effect("renders the tool row before the operation exists, then links it", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, toolObserved(activityId, 3, sessionId, "in_progress", "Bash"))
			const pending = yield* activities.listBySession(sessionId)
			Vitest.assert.strictEqual(pending[0]?.operationId, null)
			yield* applyEvent(activities, operationLinked(8))
			const linked = yield* activities.listBySession(sessionId)
			Vitest.assert.strictEqual(linked[0]?.operationId, operationId)
			Vitest.assert.strictEqual(linked[0]?.status, "in_progress")
			Vitest.assert.strictEqual(linked[0]?.sequence, 3)
		})
	)
})

Vitest.layer(isolatedActivities())("status never regresses", (it) => {
	it.effect("keeps completed when a later pending and an earlier pending arrive", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, statusAdvanced(6, "completed"))
			yield* applyEvent(activities, toolObserved(activityId, 4, sessionId, "pending", "Bash"))
			yield* applyEvent(activities, statusAdvanced(7, "pending"))
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.strictEqual(listed[0]?.status, "completed")
			Vitest.assert.strictEqual(listed[0]?.statusSequence, 6)
			Vitest.assert.strictEqual(listed[0]?.sequence, 4)
			Vitest.assert.strictEqual(listed[0]?.title, "Bash")
		})
	)
})

Vitest.layer(isolatedActivities())("file operation", (it) => {
	it.effect("stores kind file and path", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, fileObserved(2, "completed"))
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.strictEqual(listed[0]?.kind, "file")
			Vitest.assert.strictEqual(listed[0]?.path, "/tmp/file.ts")
			Vitest.assert.strictEqual(listed[0]?.status, "completed")
		})
	)
})

Vitest.layer(isolatedActivities())("session isolation", (it) => {
	it.effect("lists only the requested session", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, toolObserved(activityId, 1, sessionId, "pending", "One"))
			yield* applyEvent(
				activities,
				toolObserved(otherActivityId, 2, otherSessionId, "pending", "Two")
			)
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(
				listed.map((row) => row.activityId),
				[activityId]
			)
		})
	)
})

Vitest.layer(isolatedActivities())("truncate", (it) => {
	it.effect("removes every projected activity row", () =>
		Effect.gen(function*() {
			const sql = yield* SqlClient.SqlClient
			const activities = yield* ProjectionSessionActivities
			yield* applyEvent(activities, toolObserved(activityId, 1, sessionId, "pending", "Bash"))
			yield* activities.truncate(sql)
			const listed = yield* activities.listBySession(sessionId)
			Vitest.assert.deepStrictEqual(listed, [])
		})
	)
})

Vitest.layer(isolatedEngine())("rebuild projection.session-activities", (it) => {
	it.effect("reproduces the table identically from the same event log", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			const sql = yield* SqlClient.SqlClient
			const original = yield* withPipeline(
				[projectorOf(activities)],
				Effect.gen(function*() {
					yield* waitForSequence(activities.name, 5)
					return yield* dumpTable()
				})
			)
			Vitest.assert.strictEqual(original.length, 2)
			Vitest.assert.strictEqual(original[0]?.kind, "file")
			Vitest.assert.strictEqual(original[0]?.status, "completed")
			Vitest.assert.strictEqual(original[0]?.operation_id, operationId)
			Vitest.assert.strictEqual(original[1]?.title, "Bash")
			Vitest.assert.strictEqual(original[1]?.operation_id, null)
			yield* sql`
				UPDATE projection_session_activities
				SET title = 'bogus'
				WHERE activity_id = ${activityId}
			`.withoutTransform
			const rebuilt = yield* withPipeline(
				[projectorOf(activities)],
				Effect.gen(function*() {
					const pipeline = yield* ProjectionPipeline
					yield* pipeline.rebuild(PROJECTION_SESSION_ACTIVITIES_NAME)
					yield* waitForSequence(activities.name, 5)
					return yield* dumpTable()
				})
			)
			Vitest.assert.deepStrictEqual(rebuilt, original)
		})
	)
})

Vitest.layer(isolatedGrade())("reference fixture through ProjectionSnapshotQuery", (it) => {
	it.effect("grades tool and file rows against the recorded Claude fixture", () =>
		Effect.gen(function*() {
			const activities = yield* ProjectionSessionActivities
			const query = yield* ProjectionSnapshotQuery
			const fixturePath = yield* referenceFixturePath()
			const exchanges = yield* loadFixture(fixturePath)
			const events = yield* activityEventsFromFixture(exchanges)
			yield* Effect.forEach(events, (event) => applyEvent(activities, event), {
				discard: true
			})
			const last = Arr.last(events)
			const lastSequence = Option.match(last, {
				onNone: () => 0,
				onSome: (event) => event.sequence
			})
			yield* checkpoint(PROJECTION_SESSION_ACTIVITIES_NAME, lastSequence)
			Vitest.assert.strictEqual(events.length, 2)
			const first = events[0]
			const second = events[1]
			Vitest.assert.isDefined(first)
			Vitest.assert.isDefined(second)
			const listed = yield* activities.listBySession(first.payload.sessionId)
			Vitest.assert.strictEqual(listed.length, 2)
			Vitest.assert.strictEqual(listed[0]?.kind, "file")
			Vitest.assert.strictEqual(listed[0]?.status, "completed")
			Vitest.assert.strictEqual(listed[0]?.operationId, null)
			Vitest.assert.isTrue(listed[0]?.path !== null)
			Vitest.assert.strictEqual(listed[1]?.kind, "tool")
			Vitest.assert.strictEqual(listed[1]?.status, "pending")
			Vitest.assert.strictEqual(listed[1]?.operationId, null)
			Vitest.assert.strictEqual(listed[1]?.title, "Bash")
			const snapshot = yield* query.snapshot(first.payload.sessionId)
			Vitest.assert.strictEqual(snapshot.snapshotSequence, lastSequence)
			Vitest.assert.deepStrictEqual(snapshot.activities, [
				{
					activityId: first.payload.activityId,
					sessionId: first.payload.sessionId,
					sequence: first.sequence
				},
				{
					activityId: second.payload.activityId,
					sessionId: second.payload.sessionId,
					sequence: second.sequence
				}
			])
		})
	)
})
