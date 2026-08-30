import {
	defaultProjectColor,
	PROJECT_ICON_AUTO,
	ProjectId
} from "@acepe/contracts"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { type ProjectedProject, ProjectionProjects } from "../persistence/Services/ProjectionProjects.ts"
import { AppDataDir, guardFsPath } from "./fsPathGuard.ts"

const NOW = "2026-08-20T12:00:00.000Z"

const fakeProject = (workspaceRoot: string): ProjectedProject => ({
	projectId: ProjectId.make("project-1"),
	title: "Acepe",
	workspaceRoot,
	createdAt: NOW,
	updatedAt: NOW,
	deletedAt: null,
	sessionCount: 0,
	color: defaultProjectColor(workspaceRoot),
	showExternalCliSessions: false,
	sortOrder: null,
	icon: PROJECT_ICON_AUTO,
	scanWarmedAt: NOW
})

const ProjectionProjectsFake = (projects: ReadonlyArray<ProjectedProject>) =>
	Layer.succeed(ProjectionProjects, {
		name: "projection.projects",
		apply: () => Effect.void,
		truncate: () => Effect.void,
		list: () => Effect.succeed(projects),
		get: () => Effect.succeed(Option.none())
	})

// One project root and one app data dir, both freshly created for this test
// suite's layer and shared read-only across every scenario below (they are
// only ever written into, never asserted to be empty).
const TestLive = Layer.unwrap(
	Effect.gen(function*() {
		const fs = yield* FileSystem.FileSystem
		const project = yield* fs.makeTempDirectoryScoped()
		const appData = yield* fs.makeTempDirectoryScoped()
		return Layer.mergeAll(
			ProjectionProjectsFake([fakeProject(project)]),
			Layer.succeed(AppDataDir, AppDataDir.of({ path: appData }))
		)
	})
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)))

const projectRoot = Effect.fn("projectRoot")(function*() {
	const projects = yield* ProjectionProjects
	const list = yield* projects.list()
	const project = list[0]
	if (project === undefined) {
		return yield* Effect.die("no fake project registered")
	}
	return project.workspaceRoot
})

Vitest.layer(Layer.mergeAll(TestLive, BunFileSystem.layer, BunPath.layer))("guardFsPath", (it) => {
	it.effect("allows a path inside a known project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* projectRoot()
			const target = path.join(project, "src", "file.ts")
			yield* fs.makeDirectory(path.dirname(target), { recursive: true })
			yield* fs.writeFileString(target, "hi")
			yield* guardFsPath(fs, path, target)
		})
	)

	it.effect("allows a path inside the app data directory", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const appData = yield* AppDataDir
			const target = path.join(appData.path, "settings.json")
			yield* guardFsPath(fs, path, target)
		})
	)

	it.effect("denies a path outside every allowed root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const outside = yield* fs.makeTempDirectoryScoped()
			const target = path.join(outside, "authorized_keys")
			const error = yield* Effect.flip(guardFsPath(fs, path, target))
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)

	it.effect("denies a traversal path that lexically escapes the project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* projectRoot()
			const target = path.join(project, "..", "..", "etc", "passwd")
			const error = yield* Effect.flip(guardFsPath(fs, path, target))
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)

	it.effect("denies a symlink that resolves outside every allowed root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* projectRoot()
			const outside = yield* fs.makeTempDirectoryScoped()
			const secret = path.join(outside, "secret.txt")
			yield* fs.writeFileString(secret, "top secret")
			const link = path.join(project, "escape.txt")
			yield* fs.symlink(secret, link)
			const error = yield* Effect.flip(guardFsPath(fs, path, link))
			Vitest.assert.strictEqual(error._tag, "RpcFsPathDeniedError")
		})
	)

	it.effect("allows a write target that does not exist yet, inside a project root", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const project = yield* projectRoot()
			const target = path.join(project, "new", "nested", "file.txt")
			yield* guardFsPath(fs, path, target)
		})
	)

	it.effect("leaves a non-absolute path alone", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			yield* guardFsPath(fs, path, "relative/file.txt")
		})
	)
})
