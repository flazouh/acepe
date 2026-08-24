import {
	CommandId,
	decodeDispatchExit,
	decodeGetProjectIndexExit,
	decodeInvalidateProjectIndexExit,
	decodeListProviderProjectsExit,
	decodeListProviderSessionsExit,
	decodeReadTextFileExit,
	decodeSnapshotExit,
	decodeWriteTextFileExit,
	emptySkillsCatalog,
	emptyVoiceModels,
	exitToEffect,
	MessageId,
	MessageSendCommand,
	ProjectCreateCommand,
	ProjectId,
	projectSnapshotRequest,
	SessionCreateCommand,
	SessionId,
	SkillsDiscoverCommand,
	skillsSnapshotRequest,
	VoiceModelsListCommand,
	voiceSnapshotRequest
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
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { acepeTestLive } from "../bootstrap.ts"
import { runGit } from "../git/runGit.ts"
import {
	encodedDispatch,
	encodedGetProjectIndex,
	encodedInvalidateProjectIndex,
	encodedListProviderProjects,
	encodedListProviderSessions,
	encodedReadTextFile,
	encodedSnapshot,
	encodedWriteTextFile
} from "./encodedBoundary.ts"
import { AppDataDir } from "./fsPathGuard.ts"

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

	it.effect("fills skills.discover from disk and projects the catalog", () =>
		Effect.gen(function*() {
			const dispatched = yield* encodedDispatch(
				SkillsDiscoverCommand.make({
					type: "skills.discover",
					commandId: CommandId.make("cmd-skills"),
					catalog: emptySkillsCatalog
				})
			)
			const dispatchDecoded = yield* decodeDispatchExit(dispatched)
			Vitest.assert.isTrue(Exit.isSuccess(dispatchDecoded))
			let catalogLength = 0
			for (const _step of Arr.range(0, 199)) {
				const encoded = yield* encodedSnapshot(skillsSnapshotRequest())
				const decoded = yield* decodeSnapshotExit(encoded)
				if (Exit.isSuccess(decoded) && decoded.value.skillsCatalog !== null) {
					catalogLength = decoded.value.skillsCatalog.agents.length
					break
				}
				yield* TestClock.adjust(Duration.millis(1))
				yield* Effect.yieldNow
			}
			Vitest.assert.strictEqual(catalogLength, 4)
		})
	)

	it.effect("fills voice.models.list from the voice service and projects voice", () =>
		Effect.gen(function*() {
			const dispatched = yield* encodedDispatch(
				VoiceModelsListCommand.make({
					type: "voice.models.list",
					commandId: CommandId.make("cmd-voice"),
					models: emptyVoiceModels
				})
			)
			const dispatchDecoded = yield* decodeDispatchExit(dispatched)
			Vitest.assert.isTrue(Exit.isSuccess(dispatchDecoded))
			let modelId = ""
			for (const _step of Arr.range(0, 199)) {
				const encoded = yield* encodedSnapshot(voiceSnapshotRequest())
				const decoded = yield* decodeSnapshotExit(encoded)
				if (Exit.isSuccess(decoded) && decoded.value.voice !== null) {
					modelId = decoded.value.voice.models[0]?.id ?? ""
					break
				}
				yield* TestClock.adjust(Duration.millis(1))
				yield* Effect.yieldNow
			}
			Vitest.assert.strictEqual(modelId, "external")
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

	it.effect("encodes an empty listProviderSessions Exit for a project with no history", () =>
		Effect.gen(function*() {
			const encoded = yield* encodedListProviderSessions({
				projectPath: "/tmp/acepe-encoded-boundary-unknown-project"
			})
			const decoded = yield* decodeListProviderSessionsExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.deepStrictEqual(decoded.value, [])
			}
		})
	)

	it.effect("encodes a listProviderProjects Exit", () =>
		Effect.gen(function*() {
			const encoded = yield* encodedListProviderProjects({})
			const decoded = yield* decodeListProviderProjectsExit(encoded)
			Vitest.assert.isTrue(Exit.isSuccess(decoded))
			if (Exit.isSuccess(decoded)) {
				Vitest.assert.isTrue(Array.isArray(decoded.value))
			}
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

Vitest.layer(isolated())("fs path confinement over the encoded boundary", (it) => {
	it.effect("writes and reads back a file inside a known project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const projectId = ProjectId.make("project-fs-confined")
			yield* insertProjectAt(projectId, dir)
			const target = path.join(dir, "notes.txt")
			const writeExit = yield* encodedWriteTextFile({
				path: target,
				content: "hello from inside the project",
				sessionId: SessionId.make("session-fs-confined")
			})
			const writeDecoded = yield* decodeWriteTextFileExit(writeExit)
			Vitest.assert.isTrue(Exit.isSuccess(writeDecoded))
			const readExit = yield* encodedReadTextFile({ path: target })
			const readDecoded = yield* decodeReadTextFileExit(readExit)
			Vitest.assert.isTrue(Exit.isSuccess(readDecoded))
			if (Exit.isSuccess(readDecoded)) {
				Vitest.assert.strictEqual(readDecoded.value, "hello from inside the project")
			}
		})
	)

	it.effect("writes and reads back a file inside the app data directory", () =>
		Effect.gen(function*() {
			const path = yield* Path.Path
			const appDataDir = yield* AppDataDir
			const target = path.join(appDataDir.path, "app-settings.json")
			const writeExit = yield* encodedWriteTextFile({
				path: target,
				content: "{}",
				sessionId: SessionId.make("session-fs-appdata")
			})
			const writeDecoded = yield* decodeWriteTextFileExit(writeExit)
			Vitest.assert.isTrue(Exit.isSuccess(writeDecoded))
			const readExit = yield* encodedReadTextFile({ path: target })
			const readDecoded = yield* decodeReadTextFileExit(readExit)
			Vitest.assert.isTrue(Exit.isSuccess(readDecoded))
			if (Exit.isSuccess(readDecoded)) {
				Vitest.assert.strictEqual(readDecoded.value, "{}")
			}
		})
	)

	it.effect("denies a write outside every known project root and the app data dir", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const outside = yield* fs.makeTempDirectoryScoped()
			const target = path.join(outside, "authorized_keys")
			const writeExit = yield* encodedWriteTextFile({
				path: target,
				content: "ssh-ed25519 attacker-key",
				sessionId: SessionId.make("session-fs-outside")
			})
			const decoded = yield* decodeWriteTextFileExit(writeExit)
			const error = yield* exitToEffect(decoded).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)

	it.effect("denies a traversal path that lexically escapes a project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			const projectId = ProjectId.make("project-fs-traversal")
			yield* insertProjectAt(projectId, dir)
			const target = path.join(dir, "..", "..", "etc", "passwd")
			const writeExit = yield* encodedWriteTextFile({
				path: target,
				content: "root:x:0:0::/root:/bin/sh",
				sessionId: SessionId.make("session-fs-traversal")
			})
			const decoded = yield* decodeWriteTextFileExit(writeExit)
			const error = yield* exitToEffect(decoded).pipe(Effect.flip)
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)
})
