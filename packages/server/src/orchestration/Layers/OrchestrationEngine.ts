import {
	EventId,
	type OrchestrationCommand,
	type OrchestrationEvent,
	type Sequence,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Crypto from "effect/Crypto"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	OrchestrationCommandPreviouslyRejectedError,
	OrchestrationCommandReceipts
} from "../../persistence/Services/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts"
import { decide } from "../decider.ts"
import { OrchestrationCommandInvariantError } from "../Errors.ts"
import { createEmptyReadModel, projectEvent } from "../projector.ts"
import type { OrchestrationReadModel } from "../Schemas.ts"
import {
	type OrchestrationDispatchError,
	type OrchestrationDispatchResult,
	OrchestrationEngine,
	OrchestrationEngineShutdownError,
	orchestrationCommandAckDuration,
	orchestrationCommandDuration,
	orchestrationCommandsTotal
} from "../Services/OrchestrationEngine.ts"

const EVENT_PAGE_SIZE = 1_000

const isInvariantError = Schema.is(OrchestrationCommandInvariantError)
const isPreviouslyRejectedError = Schema.is(OrchestrationCommandPreviouslyRejectedError)
const isShutdownError = Schema.is(OrchestrationEngineShutdownError)

type CommandEnvelope = {
	readonly command: OrchestrationCommand
	readonly result: Deferred.Deferred<OrchestrationDispatchResult, OrchestrationDispatchError>
	readonly startedAtMs: number
}

const assignCommittedSequences = (
	events: Arr.NonEmptyReadonlyArray<OrchestrationEvent>,
	lastSequence: Sequence
): Arr.NonEmptyReadonlyArray<OrchestrationEvent> => {
	const firstSequence = lastSequence - events.length + 1
	return Arr.map(events, (event, index) => ({
		...event,
		sequence: firstSequence + index
	}))
}

const metricOutcome = <A, E>(exit: Exit.Exit<A, E>): "success" | "interrupt" | "failure" => {
	if (Exit.isSuccess(exit)) {
		return "success"
	}
	if (Cause.hasInterruptsOnly(exit.cause)) {
		return "interrupt"
	}
	return "failure"
}

const shouldReconcile = (error: Option.Option<OrchestrationDispatchError>): boolean =>
	Option.match(error, {
		onNone: () => true,
		onSome: (value) =>
			isPreviouslyRejectedError(value) === false && isShutdownError(value) === false
	})

const makeOrchestrationEngine = Effect.gen(function*() {
	const sql = yield* SqlClient.SqlClient
	const eventStore = yield* OrchestrationEventStore
	const receipts = yield* OrchestrationCommandReceipts
	const crypto = yield* Crypto.Crypto

	const projectEvents = (
		model: OrchestrationReadModel,
		events: ReadonlyArray<OrchestrationEvent>
	) => Effect.reduce(events, () => model, projectEvent)

	const hydrateReadModel = Effect.fn("OrchestrationEngine.hydrateReadModel")(function*(
		nowIso: string
	) {
		let model = createEmptyReadModel(nowIso)
		let cursor: Sequence = 0
		while (true) {
			const page = yield* Stream.runCollect(eventStore.readFrom(cursor, EVENT_PAGE_SIZE))
			if (!Arr.isReadonlyArrayNonEmpty(page)) {
				return model
			}
			model = yield* projectEvents(model, page)
			cursor = Arr.lastNonEmpty(page).sequence
			if (page.length < EVENT_PAGE_SIZE) {
				return model
			}
		}
	})

	let commandReadModel = yield* DateTime.now.pipe(
		Effect.map(DateTime.formatIso),
		Effect.flatMap(hydrateReadModel)
	)

	const commandQueue = yield* Queue.unbounded<CommandEnvelope, Cause.Done>()
	const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>()

	const publishCommitted = Effect.fn("OrchestrationEngine.publishCommitted")(function*(
		envelope: CommandEnvelope,
		events: Arr.NonEmptyReadonlyArray<OrchestrationEvent>
	) {
		const first = Arr.headNonEmpty(events)
		yield* PubSub.publish(eventPubSub, first)
		const nowMs = yield* Clock.currentTimeMillis
		yield* Metric.update(
			Metric.withAttributes(orchestrationCommandAckDuration, {
				commandType: envelope.command.type
			}),
			Duration.millis(Math.max(0, nowMs - envelope.startedAtMs))
		)
		yield* Effect.forEach(Arr.drop(events, 1), (event) => PubSub.publish(eventPubSub, event), {
			discard: true
		})
	})

	const recordRejection = Effect.fn("OrchestrationEngine.recordRejection")(function*(
		command: OrchestrationCommand,
		error: OrchestrationCommandInvariantError
	) {
		const reason = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(error.detail)
		yield* receipts.record({
			commandId: command.commandId,
			status: "rejected",
			reason
		})
	})

	const reconcileAfterFailure = Effect.fn("OrchestrationEngine.reconcileAfterFailure")(function*(
		startSequence: Sequence
	) {
		const persisted = yield* Stream.runCollect(eventStore.readFrom(startSequence, EVENT_PAGE_SIZE))
		if (!Arr.isReadonlyArrayNonEmpty(persisted)) {
			return
		}
		commandReadModel = yield* projectEvents(commandReadModel, persisted)
		yield* Effect.forEach(persisted, (event) => PubSub.publish(eventPubSub, event), {
			discard: true
		})
	})

	const recordMetrics = Effect.fn("OrchestrationEngine.recordMetrics")(function*(
		envelope: CommandEnvelope,
		processingStartedAtMs: number,
		exit: Exit.Exit<OrchestrationDispatchResult, OrchestrationDispatchError>
	) {
		const nowMs = yield* Clock.currentTimeMillis
		const commandType = envelope.command.type
		yield* Metric.update(
			Metric.withAttributes(orchestrationCommandDuration, { commandType }),
			Duration.millis(Math.max(0, nowMs - processingStartedAtMs))
		)
		yield* Metric.update(
			Metric.withAttributes(orchestrationCommandsTotal, {
				commandType,
				outcome: metricOutcome(exit)
			}),
			1
		)
	})

	const nextIdentity = Effect.fn("OrchestrationEngine.nextIdentity")(function*(
		command: OrchestrationCommand
	) {
		const occurredAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))
		const uuid = yield* crypto.randomUUIDv4.pipe(
			Effect.mapError(
				() =>
					new OrchestrationCommandInvariantError({
						commandType: command.type,
						detail: "Failed to generate an event identifier."
					})
			)
		)
		return {
			eventId: EventId.make(uuid),
			occurredAt
		}
	})

	const commitAccepted = Effect.fn("OrchestrationEngine.commitAccepted")(function*(
		command: OrchestrationCommand,
		decided: Arr.NonEmptyReadonlyArray<OrchestrationEvent>
	) {
		return yield* Effect.uninterruptible(
			sql.withTransaction(
				Effect.gen(function*() {
					const lastSequence = yield* eventStore.append(decided)
					const committedEvents = assignCommittedSequences(decided, lastSequence)
					const nextCommandReadModel = yield* projectEvents(commandReadModel, committedEvents)
					yield* receipts.record({
						commandId: command.commandId,
						status: "accepted",
						sequence: lastSequence
					})
					return {
						committedEvents,
						lastSequence,
						nextCommandReadModel
					} as const
				})
			)
		)
	})

	const processCommand = Effect.fn("OrchestrationEngine.processCommand")(function*(
		envelope: CommandEnvelope
	) {
		yield* Effect.annotateCurrentSpan({
			"orchestration.command_id": envelope.command.commandId,
			"orchestration.command_type": envelope.command.type
		})
		const replayed = yield* receipts.replay(envelope.command.commandId)
		if (Option.isSome(replayed)) {
			return { sequence: replayed.value }
		}
		const identity = yield* nextIdentity(envelope.command)
		const decided = yield* decide(commandReadModel, envelope.command, identity)
		if (!Arr.isReadonlyArrayNonEmpty(decided)) {
			return yield* new OrchestrationCommandInvariantError({
				commandType: envelope.command.type,
				detail: "Command produced no events."
			})
		}
		const committed = yield* commitAccepted(envelope.command, decided)
		commandReadModel = committed.nextCommandReadModel
		yield* publishCommitted(envelope, committed.committedEvents)
		return { sequence: committed.lastSequence }
	})

	const handleFailureEffects = Effect.fn("OrchestrationEngine.handleFailureEffects")(function*(
		envelope: CommandEnvelope,
		startSequence: Sequence,
		exit: Exit.Exit<OrchestrationDispatchResult, OrchestrationDispatchError>
	) {
		if (Exit.isSuccess(exit)) {
			return
		}
		if (Cause.hasInterruptsOnly(exit.cause)) {
			return
		}
		const error = Cause.findErrorOption(exit.cause)
		if (shouldReconcile(error)) {
			yield* reconcileAfterFailure(startSequence).pipe(Effect.ignore)
		}
		if (Option.isSome(error) && isInvariantError(error.value)) {
			yield* recordRejection(envelope.command, error.value).pipe(Effect.ignore)
		}
	})

	const processEnvelope = (envelope: CommandEnvelope) =>
		Effect.gen(function*() {
			const startSequence = commandReadModel.snapshotSequence
			const processingStartedAtMs = yield* Clock.currentTimeMillis
			const exit = yield* Effect.exit(processCommand(envelope))
			yield* recordMetrics(envelope, processingStartedAtMs, exit).pipe(Effect.ignore)
			yield* handleFailureEffects(envelope, startSequence, exit).pipe(Effect.ignore)
			yield* Deferred.done(envelope.result, exit)
		})

	const worker = Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope), Effect.forever)
	const workerFiber = yield* Effect.forkScoped(worker)
	yield* Effect.addFinalizer((_exit) =>
		Effect.uninterruptible(
			Effect.gen(function*() {
				yield* Queue.end(commandQueue)
				yield* Fiber.join(workerFiber).pipe(Effect.ignore)
				yield* PubSub.shutdown(eventPubSub)
			})
		)
	)

	const dispatch = Effect.fn("OrchestrationEngine.dispatch")(function*(command: OrchestrationCommand) {
		const result = yield* Deferred.make<OrchestrationDispatchResult, OrchestrationDispatchError>()
		const offered = yield* Queue.offer(commandQueue, {
			command,
			result,
			startedAtMs: yield* Clock.currentTimeMillis
		})
		if (offered === false) {
			return yield* new OrchestrationEngineShutdownError({})
		}
		return yield* Deferred.await(result)
	})

	return OrchestrationEngine.of({
		dispatch,
		latestSequence: Effect.sync(() => commandReadModel.snapshotSequence),
		get streamDomainEvents() {
			return Stream.fromPubSub(eventPubSub)
		}
	})
})

export const OrchestrationEngineLive = Layer.effect(OrchestrationEngine, makeOrchestrationEngine)
