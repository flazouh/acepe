import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Stdio from "effect/Stdio"
import { parseBootstrapArgs } from "./bootstrapArgs.ts"
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine.ts"
import { ProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline.ts"
import { ProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts"
import { OrchestrationCommandReceiptsLive } from "./persistence/Layers/OrchestrationCommandReceipts.ts"
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore.ts"
import { ProjectionPendingApprovalsLive } from "./persistence/Layers/ProjectionPendingApprovals.ts"
import { ProjectionSessionActivitiesLive } from "./persistence/Layers/ProjectionSessionActivities.ts"
import { ProjectionSessionMessagesLive } from "./persistence/Layers/ProjectionSessionMessages.ts"
import { ProjectionSessionsLive } from "./persistence/Layers/ProjectionSessions.ts"
import { ProjectionCheckpointsLive } from "./persistence/Layers/ProjectionCheckpoints.ts"
import { ProjectionStateLive } from "./persistence/Layers/ProjectionState.ts"
import { ProjectionTurnsLive } from "./persistence/Layers/ProjectionTurns.ts"
import { ProjectionProjectsLive } from "./persistence/Layers/ProjectionProjects.ts"
import { ProjectionSettingsLive } from "./persistence/Layers/ProjectionSettings.ts"
import { ProjectionSkillsLive } from "./persistence/Layers/ProjectionSkills.ts"
import { ProjectionVoiceLive } from "./persistence/Layers/ProjectionVoice.ts"
import { makeSqliteLayer } from "./persistence/Layers/Sqlite.ts"
import { runMigrations } from "./persistence/Migrations.ts"
import {
	PROJECTION_SESSION_MESSAGES_NAME,
	ProjectionSessionMessages
} from "./persistence/Services/ProjectionSessionMessages.ts"
import { ProjectionPendingApprovals } from "./persistence/Services/ProjectionPendingApprovals.ts"
import { ProjectionSessionActivities } from "./persistence/Services/ProjectionSessionActivities.ts"
import { ProjectionSessions } from "./persistence/Services/ProjectionSessions.ts"
import { ProjectionTurns } from "./persistence/Services/ProjectionTurns.ts"
import { ProjectionCheckpoints } from "./persistence/Services/ProjectionCheckpoints.ts"
import { ProjectionProjects } from "./persistence/Services/ProjectionProjects.ts"
import { ProjectionSettings } from "./persistence/Services/ProjectionSettings.ts"
import { ProjectionSkills } from "./persistence/Services/ProjectionSkills.ts"
import { ProjectionVoice } from "./persistence/Services/ProjectionVoice.ts"
import { HardcodedProviderLive } from "./provider/HardcodedProvider.ts"
import { FileIndexServiceLive } from "./fileIndex/Layers/FileIndexService.ts"
import { FileIndexWarmOnImportLive } from "./fileIndex/Layers/FileIndexWarmOnImport.ts"
import { GitServiceLive } from "./git/Layers/GitService.ts"
import { RpcHandlersLive } from "./rpc/handlers.ts"
import { runStdioServer } from "./rpc/stdio.ts"
import { SkillsServiceLive } from "./skills/Layers/SkillsService.ts"
import { VoiceRuntimeLive } from "./voice/Layers/VoiceRuntime.ts"

const decodeProjectorName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

export type AcepeLiveInput = {
	readonly filename: string
	readonly tokenDelay: Duration.Duration
	readonly skillsHomeDir?: string
}

const persistenceAt = (filename: string) => {
	const sqlite = makeSqliteLayer({ filename, readonly: false })
	const migrated = Layer.effectDiscard(runMigrations).pipe(Layer.provideMerge(sqlite))
	return Layer.mergeAll(
		OrchestrationEventStoreLive,
		OrchestrationCommandReceiptsLive,
		ProjectionStateLive,
		ProjectionSessionsLive,
		ProjectionSessionMessagesLive,
		ProjectionTurnsLive,
		ProjectionSessionActivitiesLive,
		ProjectionCheckpointsLive,
		ProjectionPendingApprovalsLive,
		ProjectionProjectsLive,
		ProjectionSettingsLive,
		ProjectionSkillsLive,
		ProjectionVoiceLive
	).pipe(Layer.provideMerge(migrated))
}

const engineAt = (filename: string) =>
	OrchestrationEngineLive.pipe(Layer.provideMerge(persistenceAt(filename)), Layer.provide(BunCrypto.layer))

export const acepeEngineLive = (filename: string) => engineAt(filename)

const pipelineLayer = Layer.unwrap(
	Effect.gen(function*() {
		const sessions = yield* ProjectionSessions
		const messages = yield* ProjectionSessionMessages
		const turns = yield* ProjectionTurns
		const activities = yield* ProjectionSessionActivities
		const checkpoints = yield* ProjectionCheckpoints
		const projectionPendingApprovals = yield* ProjectionPendingApprovals
		const projects = yield* ProjectionProjects
		const settings = yield* ProjectionSettings
		const skills = yield* ProjectionSkills
		const voice = yield* ProjectionVoice
		const messagesName = yield* decodeProjectorName(PROJECTION_SESSION_MESSAGES_NAME)
		return ProjectionPipelineLive([
			{
				name: sessions.name,
				apply: sessions.apply,
				truncate: sessions.truncate
			},
			{
				name: messagesName,
				apply: messages.apply,
				truncate: messages.truncate
			},
			{
				name: turns.name,
				apply: turns.apply,
				truncate: turns.truncate
			},
			{
				name: activities.name,
				apply: activities.apply,
				truncate: activities.truncate
			},
			{
				name: checkpoints.name,
				apply: checkpoints.apply,
				truncate: checkpoints.truncate
			},
			{
				name: projectionPendingApprovals.name,
				apply: projectionPendingApprovals.apply,
				truncate: projectionPendingApprovals.truncate
			},
			{
				name: projects.name,
				apply: projects.apply,
				truncate: projects.truncate
			},
			{
				name: settings.name,
				apply: settings.apply,
				truncate: settings.truncate
			},
			{
				name: skills.name,
				apply: skills.apply,
				truncate: skills.truncate
			},
			{
				name: voice.name,
				apply: voice.apply,
				truncate: voice.truncate
			}
		])
	})
)

export const makeAcepeLive = (input: AcepeLiveInput) => {
	const engine = engineAt(input.filename)
	const snapshots = ProjectionSnapshotQueryLive
	const bunPlatform = Layer.mergeAll(
		BunFileSystem.layer,
		BunPath.layer,
		BunChildProcessSpawner.layer.pipe(
			Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
		)
	)
	const fileIndex = FileIndexWarmOnImportLive.pipe(
		Layer.provideMerge(FileIndexServiceLive),
		Layer.provide(bunPlatform)
	)
	const git = Layer.unwrap(
		Effect.gen(function*() {
			const path = yield* Path.Path
			return GitServiceLive({
				worktreesRoot: path.join(path.dirname(input.filename), "worktrees"),
				gitBin: "git",
				ghBin: "gh"
			})
		})
	).pipe(Layer.provide(bunPlatform), Layer.provide(BunCrypto.layer))
	const skills = Layer.unwrap(
		Effect.gen(function*() {
			if (input.skillsHomeDir !== undefined) {
				return SkillsServiceLive({ homeDir: input.skillsHomeDir })
			}
			const homeDir = yield* Config.string("HOME").pipe(
				Config.orElse(() => Config.string("USERPROFILE"))
			)
			return SkillsServiceLive({ homeDir })
		})
	).pipe(Layer.provide(bunPlatform))
	const voice = VoiceRuntimeLive.pipe(Layer.provide(bunPlatform))
	const rpc = RpcHandlersLive.pipe(
		Layer.provideMerge(snapshots),
		Layer.provideMerge(fileIndex),
		Layer.provideMerge(git),
		Layer.provideMerge(skills),
		Layer.provideMerge(voice)
	)
	return Layer.mergeAll(
		rpc,
		HardcodedProviderLive(input.tokenDelay),
		pipelineLayer,
		snapshots
	).pipe(Layer.provideMerge(engine))
}

export const acepeTestLive = (tokenDelay: Duration.Duration) =>
	Layer.unwrap(
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			return makeAcepeLive({
				filename: path.join(dir, "acepe-test.db"),
				tokenDelay,
				skillsHomeDir: path.join(dir, "skills-home")
			})
		})
	).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				BunFileSystem.layer,
				BunPath.layer,
				BunChildProcessSpawner.layer.pipe(
					Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
				)
			)
		)
	)

const stdioFilename = Effect.gen(function*() {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const dir = yield* fs.makeTempDirectory()
	return path.join(dir, "acepe.db")
})

export const runBootstrap = Effect.fn("runBootstrap")(function*() {
	const stdio = yield* Stdio.Stdio
	const args = parseBootstrapArgs(yield* stdio.args)
	if (args.stdio === false) {
		return
	}
	const filename = yield* Option.match(args.dbFilename, {
		onNone: () => stdioFilename,
		onSome: (value) => Effect.succeed(value)
	})
	yield* runStdioServer().pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(
			makeAcepeLive({
				filename,
				tokenDelay: args.tokenDelay
			})
		)
	)
})

const importMeta = import.meta as ImportMeta & { readonly main?: boolean }
if (importMeta.main === true) {
	BunRuntime.runMain(
		runBootstrap().pipe(
			Effect.scoped,
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(Layer.mergeAll(BunServices.layer, BunFileSystem.layer, BunPath.layer))
		)
	)
}
