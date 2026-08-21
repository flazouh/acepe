import {
	CommandId,
	EventId,
	type OrchestrationEvent,
	OrchestrationEvent as OrchestrationEventSchema,
	ProjectId,
	Sequence
} from "@acepe/contracts"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"

const commandId = CommandId.make("cmd-stream")
const projectId = ProjectId.make("project-stream")
const OrchestrationEventLine = Schema.fromJsonString(OrchestrationEventSchema)
const encodeEventLine = Schema.encodeEffect(OrchestrationEventLine)
export const decodeEventLine = Schema.decodeUnknownEffect(OrchestrationEventLine)

export const parseFromFlag = Effect.fn("parseFromFlag")(function*(
	args: ReadonlyArray<string>
) {
	const index = Arr.findFirstIndex(args, (arg) => arg === "--from")
	const raw = Option.flatMap(index, (i) => Arr.get(args, i + 1))
	const text = Option.getOrElse(raw, () => "0")
	const n = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(text)
	return yield* Schema.decodeUnknownEffect(Sequence)(n)
})

export const eventAtSequence = (sequence: Sequence): OrchestrationEvent => ({
	sequence,
	eventId: EventId.make(`event-${sequence}`),
	aggregateKind: "project",
	aggregateId: projectId,
	occurredAt: "2026-08-20T12:00:00.000Z",
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

export const runEventStream = Effect.fn("runEventStream")(function*() {
	const stdio = yield* Stdio.Stdio
	const args = yield* stdio.args
	const fromSequence = yield* parseFromFlag(args)
	const start = fromSequence + 1
	yield* Stream.iterate(start, (n) => n + 1).pipe(
		Stream.schedule(Schedule.spaced(Duration.millis(20))),
		Stream.mapEffect((n) =>
			Schema.decodeUnknownEffect(Sequence)(n).pipe(
				Effect.flatMap((sequence) => encodeEventLine(eventAtSequence(sequence)))
			)
		),
		Stream.runForEach((line) =>
			Stream.run(Stream.encodeText(Stream.succeed(`${line}\n`)), stdio.stdout())
		)
	)
})

const importMeta = import.meta as ImportMeta & { readonly main?: boolean }
if (importMeta.main === true) {
	BunRuntime.runMain(
		runEventStream().pipe(
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(BunServices.layer)
		)
	)
}
