import { mcpSnapshotRequest, skillsSnapshotRequest } from "@acepe/contracts"
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as TestClock from "effect/testing/TestClock"
import { makeAcepeLive } from "../bootstrap.ts"
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts"
import { seedLibrary } from "./seedLibrary.ts"
import {
	seedSkillsMcp,
	SKILLS_MCP_SEED_HOME,
	SKILLS_MCP_SEED_SKILL_FOLDER
} from "./seedSkillsMcp.ts"
import { LIBRARY_SEED_PROJECT_ID } from "./seedLibrary.ts"

const isolated = () =>
	Layer.unwrap(
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const dir = yield* fs.makeTempDirectoryScoped()
			return makeAcepeLive({
				filename: path.join(dir, "acepe-test.db"),
				tokenDelay: Duration.zero,
				skillsHomeDir: SKILLS_MCP_SEED_HOME
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
		),
		Layer.fresh
	)

const waitForSeededSkillsMcp = Effect.fn("waitForSeededSkillsMcp")(function*() {
	const query = yield* ProjectionSnapshotQuery
	for (const _step of Arr.range(0, 199)) {
		const skillsSnap = yield* query.forRequest(skillsSnapshotRequest())
		const mcpSnap = yield* query.forRequest(mcpSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
		const claudeSkills = skillsSnap.skillsCatalog?.agentSkills.find(
			(row) => row.agentId === "claude-code"
		)
		const hasSkill =
			claudeSkills?.skills.some((skill) => skill.name === SKILLS_MCP_SEED_SKILL_FOLDER) === true
		const hasServer = mcpSnap.mcpCatalog?.catalog.servers.some((server) => server.id === "github") === true
		const hasOption =
			mcpSnap.preconnectionOptions?.options.some((option) => option.id === "reasoning_effort") ===
			true
		if (hasSkill && hasServer && hasOption) {
			return { skillsSnap, mcpSnap }
		}
		yield* TestClock.adjust(Duration.millis(1))
		yield* Effect.yieldNow
	}
	return {
		skillsSnap: yield* query.forRequest(skillsSnapshotRequest()),
		mcpSnap: yield* query.forRequest(mcpSnapshotRequest(LIBRARY_SEED_PROJECT_ID))
	}
})

Vitest.layer(isolated())("seedSkillsMcp", (it) => {
	it.effect("discovers the seeded skill, mcp server, and claude reasoning option", () =>
		Effect.gen(function*() {
			yield* seedLibrary()
			yield* seedSkillsMcp()
			const { skillsSnap, mcpSnap } = yield* waitForSeededSkillsMcp()
			const claudeSkills = skillsSnap.skillsCatalog?.agentSkills.find(
				(row) => row.agentId === "claude-code"
			)
			Vitest.assert.strictEqual(
				claudeSkills?.skills.some((skill) => skill.name === SKILLS_MCP_SEED_SKILL_FOLDER),
				true
			)
			Vitest.assert.strictEqual(
				mcpSnap.mcpCatalog?.catalog.servers.some((server) => server.id === "github"),
				true
			)
			Vitest.assert.strictEqual(
				mcpSnap.preconnectionOptions?.options.some((option) => option.id === "reasoning_effort"),
				true
			)
		})
	)
})
