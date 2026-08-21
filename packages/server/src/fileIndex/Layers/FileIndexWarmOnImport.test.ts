import {
	CommandId,
	ProjectCreateCommand,
	ProjectId,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { HistoryEngineLive, HistoryPlatform } from "../../history/testLive.ts"
import { OrchestrationEngine } from "../../orchestration/Services/OrchestrationEngine.ts"
import type { FileIndexUpdate, ProjectIndex } from "../Schemas.ts"
import { FileIndexService } from "../Services/FileIndexService.ts"
import { FileIndexServiceLive } from "./FileIndexService.ts"
import { FileIndexWarmOnImportLive } from "./FileIndexWarmOnImport.ts"

const FileIndexPlatform = Layer.mergeAll(
	HistoryPlatform,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const TestLive = FileIndexWarmOnImportLive.pipe(
	Layer.provideMerge(FileIndexServiceLive),
	Layer.provideMerge(HistoryEngineLive),
	Layer.provideMerge(FileIndexPlatform)
)

const isolated = () => Layer.fresh(TestLive)

const pathsOf = (index: { readonly files: ReadonlyArray<{ readonly path: string }> }) =>
	Arr.sort(
		Arr.map(index.files, (file) => file.path),
		Str.Order
	)

const emptyProjectIndex = Effect.fn("emptyProjectIndex")(function*(projectPath: string) {
	const decoded = yield* Schema.decodeUnknownEffect(TrimmedNonEmptyString)(projectPath)
	return {
		projectPath: decoded,
		files: Arr.empty(),
		gitStatus: Arr.empty(),
		totalFiles: 0,
		totalLines: 0
	} satisfies ProjectIndex
})

const recordingFileIndex = (seen: Ref.Ref<ReadonlyArray<string>>) =>
	Layer.succeed(
		FileIndexService,
		FileIndexService.of({
			getProjectIndex: (projectPath) => emptyProjectIndex(projectPath),
			prewarm: (projectPath) =>
				Ref.update(seen, (paths) => Arr.append(paths, projectPath)).pipe(
					Effect.flatMap(() => emptyProjectIndex(projectPath))
				),
			applyUpdates: (projectPath: string, _updates: ReadonlyArray<FileIndexUpdate>) =>
				emptyProjectIndex(projectPath),
			invalidate: (_projectPath: string) => Effect.void
		})
	)

Vitest.layer(isolated())("FileIndexWarmOnImportLive", (it) => {
	it.effect("pre-warms the scan cache when a project is imported", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const engine = yield* OrchestrationEngine
			const fileIndex = yield* FileIndexService
			const dir = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(dir, "main.ts"), "export const main = 1\n")
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-file-index-import"),
					projectId: ProjectId.make("project-file-index"),
					title: "Indexed",
					workspaceRoot: dir
				})
			)
			yield* Effect.yieldNow
			const warmed = yield* fileIndex.getProjectIndex(dir)
			yield* fs.writeFileString(path.join(dir, "late.ts"), "export const late = 1\n")
			const cached = yield* fileIndex.getProjectIndex(dir)
			Vitest.assert.deepStrictEqual(pathsOf(warmed), ["main.ts"])
			Vitest.assert.deepStrictEqual(pathsOf(cached), ["main.ts"])
		})
	)
})

Vitest.it.effect("calls prewarm when ProjectCreated is dispatched", () =>
	Effect.gen(function*() {
		const seen = yield* Ref.make<ReadonlyArray<string>>(Arr.empty())
		const workspaceRoot = "/tmp/acepe-file-index-warm-on-import"
		const live = Layer.fresh(
			FileIndexWarmOnImportLive.pipe(
				Layer.provideMerge(recordingFileIndex(seen)),
				Layer.provideMerge(HistoryEngineLive),
				Layer.provideMerge(HistoryPlatform)
			)
		)
		yield* Effect.gen(function*() {
			const engine = yield* OrchestrationEngine
			yield* engine.dispatch(
				ProjectCreateCommand.make({
					type: "project.create",
					commandId: CommandId.make("cmd-file-index-warm-record"),
					projectId: ProjectId.make("project-file-index-warm"),
					title: "Warm",
					workspaceRoot
				})
			)
			let step = 0
			while (step < 200) {
				const paths = yield* Ref.get(seen)
				if (paths.includes(workspaceRoot) === true) {
					Vitest.assert.deepStrictEqual(paths, [workspaceRoot])
					return
				}
				yield* Effect.yieldNow
				step = step + 1
			}
			const paths = yield* Ref.get(seen)
			Vitest.assert.deepStrictEqual(paths, [workspaceRoot])
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(live)
		)
	}).pipe(Effect.scoped)
)
