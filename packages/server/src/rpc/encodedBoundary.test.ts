import {
	CommandId,
	decodeDispatchExit,
	decodeGetProjectIndexExit,
	decodeInvalidateProjectIndexExit,
	decodeSnapshotExit,
	exitToEffect,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	projectSnapshotRequest,
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
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { acepeTestLive } from "../bootstrap.ts"
import { runGit } from "../git/runGit.ts"
import {
	encodedDispatch,
	encodedGetProjectIndex,
	encodedInvalidateProjectIndex,
	encodedSnapshot
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

const noneEnv = Option.none<Readonly<Record<string, string>>>()
const noAllow = Arr.empty<number>()

const gitIn = Effect.fn("gitIn")(function*(dir: string, args: ReadonlyArray<string>) {
	yield* runGit({
		gitBin: "git",
		args: Arr.fromIterable(args),
		cwd: dir,
		allowExitCodes: noAllow,
		env: noneEnv
	})
})

const NOW = "2026-08-20T12:00:00.000Z"

const insertProjectAt = Effect.fn("insertProjectAt")(function*(
	projectId: ProjectId,
	workspaceRoot: string
) {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		INSERT INTO projection_projects (
			project_id,
			title,
			workspace_root,
			created_at,
			updated_at,
			deleted_at,
			session_count,
			scan_warmed_at
		) VALUES (
			${projectId},
			${"Git encoded"},
			${workspaceRoot},
			${NOW},
			${NOW},
			NULL,
			${0},
			${NOW}
		)
	`.withoutTransform.pipe(Effect.asVoid)
})

Vitest.layer(isolated())("encoded project snapshot git status", (it) => {
	it.effect("returns live git status through the encoded snapshot Exit", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* gitIn(dir, Arr.fromIterable(["init"]))
			yield* gitIn(dir, Arr.fromIterable(["config", "user.name", "Test User"]))
			yield* gitIn(dir, Arr.fromIterable(["config", "user.email", "test@example.com"]))
			yield* gitIn(dir, Arr.fromIterable(["config", "commit.gpgsign", "false"]))
			yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\n")
			yield* gitIn(dir, Arr.fromIterable(["add", "tracked.txt"]))
			yield* gitIn(dir, Arr.fromIterable(["commit", "-m", "initial tracked file"]))
			yield* fs.writeFileString(path.join(dir, "tracked.txt"), "one\ntwo\n")
			const gitProjectId = ProjectId.make("project-git-encoded")
			yield* insertProjectAt(gitProjectId, dir)
			const encoded = yield* encodedSnapshot(projectSnapshotRequest(gitProjectId))
			const decoded = yield* decodeSnapshotExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				const project = decoded.value.projects[0]
				Vitest.assert.isDefined(project)
				Vitest.assert.isNotNull(project.gitStatus)
				const rows = project.gitStatus ?? Arr.empty()
				const tracked = Arr.findFirst(rows, (row) => row.path === "tracked.txt")
				Vitest.assert.strictEqual(Option.isSome(tracked), true)
				if (Option.isSome(tracked)) {
					Vitest.assert.strictEqual(tracked.value.status, "M")
					Vitest.assert.strictEqual(tracked.value.insertions, 1)
					Vitest.assert.strictEqual(tracked.value.deletions, 0)
				}
			}
		})
	)
})
