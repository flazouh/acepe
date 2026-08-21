import {
	CommandId,
	encodeOrchestrationCommand,
	MessageId,
	MessageSendCommand,
	type OrchestrationCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId
} from "@acepe/contracts"
import {
	ingestAppLine,
	ingestSidecarLine,
	loadFixture,
	makeCorrelator,
	replayTraffic,
	tracerBulletFixturePath,
	type CompletedExchange,
	type RecordedExchange
} from "@acepe/harness"
import { JsonRpcRequest, JsonRpcRequestLine } from "@acepe/sidecar"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import type { Done } from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { acepeTestLive } from "../bootstrap.ts"
import { handleStdioLine } from "./stdio.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)
const live = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const userMessageId = MessageId.make("message-user")
const recordedAt = "2026-08-21T12:00:00.000Z"

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId: CommandId.make("cmd-project"),
	projectId,
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

const createSession = SessionCreateCommand.make({
	type: "session.create",
	commandId: CommandId.make("cmd-session"),
	sessionId,
	projectId,
	title: "First session"
})

const sendMessage = MessageSendCommand.make({
	type: "message.send",
	commandId: CommandId.make("cmd-message"),
	sessionId,
	messageId: userMessageId,
	text: "Ping"
})

const encodeRequest = Effect.fn("encodeRequest")(function*(
	id: number,
	method: string,
	params: unknown
) {
	return yield* Schema.encodeUnknownEffect(JsonRpcRequestLine)(
		yield* Schema.decodeUnknownEffect(JsonRpcRequest)({
			jsonrpc: "2.0",
			id,
			method,
			params
		})
	)
})

const asRecorded = (exchange: CompletedExchange): RecordedExchange => ({
	recordedAt,
	command: exchange.command,
	payload: exchange.payload,
	response: exchange.response,
	notifications: exchange.notifications
})

const collectExchange = Effect.fn("collectExchange")(function*(
	id: number,
	command: OrchestrationCommand
) {
	const correlator = yield* makeCorrelator()
	const params = yield* encodeOrchestrationCommand(command)
	const request = yield* encodeRequest(id, "dispatch", params)
	yield* ingestAppLine(correlator, request)
	const lines = yield* handleStdioLine(request)
	let completed = Option.none<CompletedExchange>()
	for (const line of lines) {
		const done = yield* ingestSidecarLine(correlator, line)
		if (Option.isSome(done)) {
			completed = done
		}
	}
	return completed
})

const collectFlow = Effect.gen(function*() {
	const project = yield* collectExchange(1, createProject)
	const session = yield* collectExchange(2, createSession)
	const message = yield* collectExchange(3, sendMessage)
	Vitest.assert.isTrue(Option.isSome(project))
	Vitest.assert.isTrue(Option.isSome(session))
	Vitest.assert.isTrue(Option.isSome(message))
	if (Option.isNone(project) || Option.isNone(session) || Option.isNone(message)) {
		return Arr.empty<RecordedExchange>()
	}
	Vitest.assert.strictEqual(project.value.notifications.length, 1)
	Vitest.assert.strictEqual(session.value.notifications.length, 1)
	Vitest.assert.strictEqual(message.value.notifications.length, 4)
	return Arr.map([project.value, session.value, message.value], asRecorded)
})

const gradeAgainst = Effect.fn("gradeAgainst")(function*(exchanges: ReadonlyArray<RecordedExchange>) {
	const toImpl = yield* Queue.unbounded<string, Done>()
	const fromImpl = yield* Queue.unbounded<string, Done>()
	yield* Stream.fromQueue(toImpl).pipe(
		Stream.runForEach((line) =>
			handleStdioLine(line).pipe(
				Effect.flatMap((lines) =>
					Effect.forEach(lines, (out) => Queue.offer(fromImpl, out), { discard: true })
				)
			)
		),
		Effect.forkChild
	)
	return yield* replayTraffic({
		exchanges,
		implLines: Stream.fromQueue(fromImpl),
		writeToImpl: (line) => Queue.offer(toImpl, line).pipe(Effect.asVoid),
		onFinished: Queue.end(toImpl).pipe(Effect.asVoid),
		skipCommands: Arr.empty(),
		responseTimeout: Duration.seconds(5)
	})
})

Vitest.it.effect("grades a recorded tracer bullet flow against a fresh stdio impl", () =>
	Effect.gen(function*() {
		const recorded = yield* Effect.scoped(
			collectFlow.pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(live())
			)
		)
		const grades = yield* Effect.scoped(
			gradeAgainst(recorded).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(live())
			)
		)
		Vitest.assert.strictEqual(grades.length, 3)
		Vitest.assert.isTrue(Arr.every(grades, (grade) => grade.status === "pass"))
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(Platform)
	)
)

Vitest.it.effect("grades the committed tracer bullet fixture against stdio", () =>
	Effect.gen(function*() {
		const fixturePath = yield* tracerBulletFixturePath()
		const fixture = yield* loadFixture(fixturePath)
		Vitest.assert.strictEqual(fixture.length, 3)
		const grades = yield* Effect.scoped(
			gradeAgainst(fixture).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(live())
			)
		)
		Vitest.assert.strictEqual(grades.length, 3)
		Vitest.assert.isTrue(Arr.every(grades, (grade) => grade.status === "pass"))
	}).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(Platform)
	)
)
