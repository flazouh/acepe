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
	makeCorrelator,
	type CompletedExchange
} from "@acepe/harness"
import {
	JsonRpcRequest,
	JsonRpcRequestLine,
	SidecarNotificationLine
} from "@acepe/sidecar"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { acepeTestLive } from "../bootstrap.ts"
import { handleStdioLine } from "./stdio.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const projectId = ProjectId.make("project-1")
const sessionId = SessionId.make("session-1")
const userMessageId = MessageId.make("message-user")

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

const dispatchLine = Effect.fn("dispatchLine")(function*(id: number, command: OrchestrationCommand) {
	const params = yield* encodeOrchestrationCommand(command)
	const line = yield* encodeRequest(id, "dispatch", params)
	return yield* handleStdioLine(line)
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
	yield* Effect.forEach(lines, (line) =>
		ingestSidecarLine(correlator, line).pipe(
			Effect.flatMap((done) =>
				Effect.sync(() => {
					if (Option.isSome(done)) {
						completed = done
					}
				})
			)
		)
	)
	return completed
})

Vitest.layer(isolated())("stdio json-rpc", (it) => {
	it.effect("skips a blank line", () =>
		Effect.gen(function*() {
			const lines = yield* handleStdioLine("   ")
			Vitest.assert.deepStrictEqual(lines, [])
		})
	)

	it.effect("rejects an unknown method", () =>
		Effect.gen(function*() {
			const line = yield* encodeRequest(9, "ping", {})
			const lines = yield* handleStdioLine(line)
			Vitest.assert.strictEqual(lines.length, 1)
			Vitest.assert.isTrue(lines[0]?.includes("Unknown method"))
		})
	)

	it.effect("emits ProjectCreated then a dispatch success for project.create", () =>
		Effect.gen(function*() {
			const exchange = yield* collectExchange(1, createProject)
			Vitest.assert.isTrue(Option.isSome(exchange))
			if (Option.isNone(exchange)) {
				return
			}
			const response = exchange.value.response
			Vitest.assert.isTrue(Schema.is(Schema.Record(Schema.String, Schema.Json))(response))
			if (Schema.is(Schema.Record(Schema.String, Schema.Json))(response)) {
				const result = response.result
				Vitest.assert.isTrue(Schema.is(Schema.Record(Schema.String, Schema.Json))(result))
				if (Schema.is(Schema.Record(Schema.String, Schema.Json))(result)) {
					Vitest.assert.strictEqual(result.sequence, 1)
				}
			}
			Vitest.assert.strictEqual(exchange.value.notifications.length, 1)
		})
	)

	it.effect("streams tracer token notifications after message.send", () =>
		Effect.gen(function*() {
			yield* dispatchLine(1, createProject)
			yield* dispatchLine(2, createSession)
			const params = yield* encodeOrchestrationCommand(sendMessage)
			const request = yield* encodeRequest(3, "dispatch", params)
			const lines = yield* handleStdioLine(request)
			Vitest.assert.strictEqual(lines.length, 5)
			const decoded = yield* Schema.decodeUnknownEffect(SidecarNotificationLine)(lines[0] ?? "")
			Vitest.assert.strictEqual(decoded.method, "events")
			Vitest.assert.isTrue((lines[0] ?? "").includes("MessageSent"))
			Vitest.assert.isTrue((lines[1] ?? "").includes("Hello"))
			Vitest.assert.isTrue((lines[2] ?? "").includes(" from"))
			Vitest.assert.isTrue((lines[3] ?? "").includes(" Acepe."))
			const correlator = yield* makeCorrelator()
			yield* ingestAppLine(correlator, request)
			let completed = Option.none<CompletedExchange>()
			for (const line of lines) {
				const done = yield* ingestSidecarLine(correlator, line)
				if (Option.isSome(done)) {
					completed = done
				}
			}
			Vitest.assert.isTrue(Option.isSome(completed))
			if (Option.isSome(completed)) {
				Vitest.assert.strictEqual(completed.value.notifications.length, 4)
			}
		})
	)
})
