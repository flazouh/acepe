import {
	CommandId,
	decodeDispatchExit,
	decodeGetProjectIndexExit,
	decodeInvalidateProjectIndexExit,
	exitToEffect,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	SessionCreateCommand,
	SessionId
} from "@acepe/contracts"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { acepeTestLive } from "../bootstrap.ts"
import {
	encodedDispatch,
	encodedGetProjectIndex,
	encodedInvalidateProjectIndex
} from "./encodedBoundary.ts"

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

	it.effect("encodes a getProjectIndex Exit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "main.ts"), "export const main = 1\n")
			const encoded = yield* encodedGetProjectIndex({ projectPath: dir })
			const decoded = yield* decodeGetProjectIndexExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.strictEqual(decoded.value.projectPath, dir)
				Vitest.assert.strictEqual(
					Arr.some(decoded.value.files, (file) => file.path === "main.ts"),
					true
				)
			}
		})
	)

	it.effect("encodes a missing-root getProjectIndex failure Exit", () =>
		Effect.gen(function*() {
			const encoded = yield* encodedGetProjectIndex({
				projectPath: "/missing/acepe-file-index-encoded"
			})
			const decoded = yield* decodeGetProjectIndexExit(encoded)
			const error = yield* exitToEffect(decoded).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "FileIndexRootNotFoundError")
		})
	)

	it.effect("encodes an invalidateProjectIndex Exit", () =>
		Effect.gen(function*() {
			const encoded = yield* encodedInvalidateProjectIndex({ projectPath: "/tmp/acepe" })
			const decoded = yield* decodeInvalidateProjectIndexExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
		})
	)
})
