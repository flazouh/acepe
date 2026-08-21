import {
	CommandId,
	decodeDispatchExit,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { acepeTestLive } from "../bootstrap.ts"
import { encodedDispatch } from "./encodedBoundary.ts"

const isolated = () => acepeTestLive(Duration.zero).pipe(Layer.fresh)

const createProject = ProjectCreateCommand.make({
	type: "project.create",
	commandId: CommandId.make("cmd-project"),
	projectId: ProjectId.make("project-1"),
	title: "Acepe",
	workspaceRoot: "/tmp/acepe"
})

Vitest.layer(isolated())("encoded Electrobun boundary", (it) => {
	it.effect("encodes a dispatch success Exit", () =>
		Effect.gen(function*() {
			const encoded = yield* encodedDispatch(createProject)
			const decoded = yield* decodeDispatchExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.strictEqual(decoded.value.sequence, 1)
			}
		})
	)

	it.effect("accepts a later message.send after session.create", () =>
		Effect.gen(function*() {
			yield* encodedDispatch(createProject)
			yield* encodedDispatch(
				SessionCreateCommand.make({
					type: "session.create",
					commandId: CommandId.make("cmd-session"),
					sessionId: SessionId.make("session-1"),
					projectId: ProjectId.make("project-1"),
					title: "First session"
				})
			)
			const encoded = yield* encodedDispatch(
				MessageSendCommand.make({
					type: "message.send",
					commandId: CommandId.make("cmd-message"),
					sessionId: SessionId.make("session-1"),
					messageId: MessageId.make("message-user"),
					text: "Ping"
				})
			)
			const decoded = yield* decodeDispatchExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.strictEqual(decoded.value.sequence, 3)
			}
		})
	)
})
