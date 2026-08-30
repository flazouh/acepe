import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient"
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
import { ProjectionGitLive } from "./persistence/Layers/ProjectionGit.ts"
import { ProjectionMcpLive } from "./persistence/Layers/ProjectionMcp.ts"
import { ProjectionTerminalLive } from "./persistence/Layers/ProjectionTerminal.ts"
import { ProjectionSessionReviewStateLive } from "./persistence/Layers/ProjectionSessionReviewState.ts"
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
import { ProjectionGit } from "./persistence/Services/ProjectionGit.ts"
import { ProjectionMcp } from "./persistence/Services/ProjectionMcp.ts"
import { ProjectionTerminal } from "./persistence/Services/ProjectionTerminal.ts"
import { ProjectionSessionReviewState } from "./persistence/Services/ProjectionSessionReviewState.ts"
import { HardcodedProviderLive } from "./provider/HardcodedProvider.ts"
import { platformKeyFromHost } from "./provider/agentJson.ts"
import { AgentAuthenticatorLive } from "./provider/Layers/AgentAuthenticator.ts"
import {
	AgentInstallerLive,
	AgentInstallerUnsupportedPlatformLive,
	defaultAgentInstallerOptions
} from "./provider/Layers/AgentInstaller.ts"
import { makeLiveClaudeAdapter } from "./provider/Layers/Claude/Adapter.ts"
import { makeLiveCodexAdapter } from "./provider/Layers/Codex/Adapter.ts"
import { makeLiveCopilotAdapter } from "./provider/Layers/Copilot/Adapter.ts"
import { makeLiveCursorAdapter } from "./provider/Layers/Cursor/Adapter.ts"
import { makeLiveOpenCodeAdapter } from "./provider/Layers/OpenCode/Adapter.ts"
import { ProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry.ts"
import { ProviderBridgeLive } from "./provider/Layers/ProviderBridge.ts"
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry.ts"
import { FileIndexServiceLive } from "./fileIndex/Layers/FileIndexService.ts"
import { FileIndexWarmOnImportLive } from "./fileIndex/Layers/FileIndexWarmOnImport.ts"
import { GitServiceLive } from "./git/Layers/GitService.ts"
import { ProviderSessionDiscoveryLive } from "./history/discovery/ProviderSessionDiscovery.ts"
import { ClaudeHistoryLive } from "./history/Layers/ClaudeHistory.ts"
import { McpCatalogLive } from "./mcp/Layers/McpCatalog.ts"
import { CheckpointServiceLive } from "./checkpoint/Layers/CheckpointService.ts"
import { ProviderUsageServiceLive } from "./providerUsage/Layers/ProviderUsageService.ts"
import { SecurityKeychainLive } from "./providerUsage/Layers/SecurityKeychain.ts"
import { AppDataDir } from "./rpc/fsPathGuard.ts"
import { RpcHandlersLive } from "./rpc/handlers.ts"
import { runStdioServer } from "./rpc/stdio.ts"
import { SkillsServiceLive } from "./skills/Layers/SkillsService.ts"
import { BunPtyAdapterLive } from "./terminal/Layers/BunPtyAdapter.ts"
import { defaultTerminalServiceOptions, TerminalServiceLive } from "./terminal/Layers/TerminalService.ts"
import { TerminalRegistryLive } from "./terminal/Layers/TerminalRegistry.ts"
import { VoiceProgressBridgeLive } from "./voice/Layers/VoiceProgressBridge.ts"
import { makeVoiceRuntimeLive } from "./voice/Layers/VoiceRuntime.ts"

const decodeProjectorName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

export type AcepeLiveInput = {
	readonly filename: string
	readonly tokenDelay: Duration.Duration
	readonly skillsHomeDir?: string
	/**
	 * Whether the electrobun QA surface is compiled into this build (unsigned
	 * builds only). Gates the injectable fake voice audio source — see
	 * `voice/Layers/VoiceRuntime.ts`. Defaults to `false` (production).
	 */
	readonly voiceQaSurfaceEnabled?: boolean
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
		ProjectionVoiceLive,
		ProjectionGitLive,
		ProjectionMcpLive,
		ProjectionTerminalLive,
		ProjectionSessionReviewStateLive
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
		const gitReview = yield* ProjectionGit
		const mcp = yield* ProjectionMcp
		const terminal = yield* ProjectionTerminal
		const sessionReviewState = yield* ProjectionSessionReviewState
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
			},
			{
				name: gitReview.name,
				apply: gitReview.apply,
				truncate: gitReview.truncate
			},
			{
				name: mcp.name,
				apply: mcp.apply,
				truncate: mcp.truncate
			},
			{
				name: terminal.name,
				apply: terminal.apply,
				truncate: terminal.truncate
			},
			{
				name: sessionReviewState.name,
				apply: sessionReviewState.apply,
				truncate: sessionReviewState.truncate
			}
		])
	})
)

// Every live provider adapter the product ships, alongside the tracer
// HardcodedProviderLive. Sessions pick one or the other by whether
// session.create carried a providerId (see ProviderBridge.ts / decider.ts's
// session.create case) — HardcodedProvider keeps driving every session it
// always has.
//
// Each makeLive*Adapter() only probes presence and resolves spawn config at
// construction (fs.exists-style checks); none of them spawns a subprocess or
// calls out to a provider SDK until a session actually uses that provider
// (openSession/sendPrompt on the adapter), so building this registry eagerly
// at bootstrap stays lazy in the sense that matters. A provider whose CLI is
// absent registers all the same and reports installed: false.
//
// Cursor and Copilot were both missing here until #282. Cursor's only launch
// path read AgentInstaller, a service needing a PlatformKey nothing detects
// and a layer nothing builds; Copilot had no makeLive* at all. Both now
// resolve their own CLI off PATH, the same probe the other three use.
//
// Lifted out of makeAcepeLive so the registered set is one named thing a test
// can build and read (see bootstrap.test.ts), instead of a list buried in a
// closure that only a running app could prove.
export const LiveProviderAdaptersLive = (managedAgentsDir: Option.Option<string>) =>
	Layer.unwrap(
	Effect.gen(function*() {
		const claude = yield* makeLiveClaudeAdapter()
		const codex = yield* makeLiveCodexAdapter({
			cacheDir: managedAgentsDir,
			command: Option.none(),
			args: Option.none(),
			config: Option.none()
		})
		const opencode = yield* makeLiveOpenCodeAdapter()
		const cursor = yield* makeLiveCursorAdapter()
		const copilot = yield* makeLiveCopilotAdapter()
		return ProviderAdapterRegistryLive([claude, codex, opencode, cursor, copilot])
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
	const providerDiscovery = ProviderSessionDiscoveryLive.pipe(Layer.provide(bunPlatform))
	// ClaudeHistoryLive needs ProjectionSnapshotQuery too (importDirectory
	// snapshots the sessions it just imported) -- provide the same
	// `snapshots` instance directly rather than relying on `rpc`'s merge
	// order, since a later `Layer.provideMerge` in that chain does not feed
	// an earlier one's output back into it.
	const claudeHistory = ClaudeHistoryLive.pipe(Layer.provide(bunPlatform), Layer.provide(snapshots))
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
	const mcpCatalog = Layer.unwrap(
		Effect.gen(function*() {
			if (input.skillsHomeDir !== undefined) {
				return McpCatalogLive({ homeDir: input.skillsHomeDir })
			}
			const homeDir = yield* Config.string("HOME").pipe(
				Config.orElse(() => Config.string("USERPROFILE"))
			)
			return McpCatalogLive({ homeDir })
		})
	).pipe(Layer.provide(bunPlatform))
	const voice = makeVoiceRuntimeLive({
		qaSurfaceEnabled: input.voiceQaSurfaceEnabled ?? false
	}).pipe(Layer.provide(bunPlatform))
	const checkpoint = CheckpointServiceLive.pipe(
		Layer.provide(engine),
		Layer.provide(bunPlatform),
		Layer.provide(BunCrypto.layer)
	)
	// The fs-path confinement guard's "app data dir" root is this instance's
	// own sqlite directory, not re-derived from env vars — see
	// rpc/fsPathGuard.ts.
	const appDataDir = Layer.unwrap(
		Effect.gen(function*() {
			const path = yield* Path.Path
			return Layer.succeed(AppDataDir, AppDataDir.of({ path: path.dirname(path.resolve(input.filename)) }))
		})
	).pipe(Layer.provide(bunPlatform))
	const terminal = TerminalServiceLive(defaultTerminalServiceOptions).pipe(
		Layer.provide(BunPtyAdapterLive),
		Layer.provide(bunPlatform),
		Layer.provide(BunCrypto.layer)
	)
	const providerUsage = ProviderUsageServiceLive().pipe(
		Layer.provide(SecurityKeychainLive.pipe(Layer.provide(bunPlatform))),
		Layer.provide(BunHttpClient.layer),
		Layer.provide(appDataDir),
		Layer.provide(bunPlatform)
	)
	// Defined before `rpc` (moved up from its original position after `rpc`)
	// so the agentCall utility RPC's routeAgentCall (rpc/handlers.ts's
	// agentCall field) can read live adapter presence off the same
	// ProviderRegistry instance ProviderBridge resolves adapters from --
	// one registry, two consumers, not two independently-probed registries.
	// One managed install directory, named once. AgentInstaller writes it and
	// the Codex adapter's cachedCodexBinaryPath reads that exact layout
	// (<dir>/<agentId>/meta.json plus the cmd it names) -- bootstrap used to
	// hand the adapter Option.none() because no layer built the installer, so
	// an installed agent was a directory nothing read.
	const managedAgentsDir = Effect.gen(function*() {
		const path = yield* Path.Path
		return path.join(path.dirname(path.resolve(input.filename)), "agents")
	})
	const providerAdapters = Layer.unwrap(
		Effect.map(managedAgentsDir, (dir) => LiveProviderAdaptersLive(Option.some(dir)))
	).pipe(Layer.provide(BunHttpClient.layer), Layer.provide(bunPlatform))
	const providerRegistry = ProviderRegistryLive.pipe(Layer.provide(providerAdapters))
	// The agent installer the agentCall RPC's agent.install/agent.uninstall
	// ops run. Its managed directory sits beside this instance's sqlite file,
	// under the same root the fs-path guard treats as the app data dir. Host
	// os/arch are read straight off the runtime here because bootstrap is
	// where every other host-shaped choice already happens (the Bun platform
	// layers above); a host outside PLATFORM_KEYS gets an installer that says
	// so per call rather than taking the whole app down.
	const agentInstaller = Layer.unwrap(
		Effect.gen(function*() {
			const detected = platformKeyFromHost(process.platform, process.arch)
			if (Option.isNone(detected)) {
				return AgentInstallerUnsupportedPlatformLive(`${process.platform}-${process.arch}`)
			}
			const cacheDir = yield* managedAgentsDir
			return AgentInstallerLive(defaultAgentInstallerOptions(cacheDir, detected.value))
		})
	).pipe(
		Layer.provide(BunHttpClient.layer),
		Layer.provide(BunCrypto.layer),
		Layer.provide(bunPlatform)
	)
	const rpc = RpcHandlersLive.pipe(
		Layer.provideMerge(snapshots),
		Layer.provideMerge(fileIndex),
		Layer.provideMerge(providerDiscovery),
		Layer.provideMerge(claudeHistory),
		Layer.provideMerge(git),
		Layer.provideMerge(checkpoint),
		Layer.provideMerge(skills),
		Layer.provideMerge(mcpCatalog),
		Layer.provideMerge(voice),
		Layer.provideMerge(appDataDir),
		Layer.provideMerge(terminal),
		Layer.provideMerge(TerminalRegistryLive),
		Layer.provideMerge(providerUsage),
		Layer.provideMerge(providerRegistry),
		Layer.provideMerge(agentInstaller),
		// Runs the agent's own login command for the agentCall RPC's
		// agent.authenticate op. It needs nothing but a spawner: the token
		// each login writes goes into that CLI's own credential store, and
		// Acepe keeps no store of its own for one.
		Layer.provideMerge(AgentAuthenticatorLive.pipe(Layer.provide(bunPlatform))),
		Layer.provideMerge(bunPlatform)
	)
	const providerBridge = ProviderBridgeLive.pipe(Layer.provideMerge(providerAdapters))
	// Carries the live microphone level and model download progress from
	// VoiceService's PubSub into the orchestration event lane -- see
	// voice/Layers/VoiceProgressBridge.ts.
	const voiceProgressBridge = VoiceProgressBridgeLive.pipe(Layer.provide(voice))
	return Layer.mergeAll(
		rpc,
		HardcodedProviderLive(input.tokenDelay),
		providerBridge,
		voiceProgressBridge,
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
