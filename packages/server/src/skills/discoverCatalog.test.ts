import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { CommandId, ProjectCreateCommand, ProjectId, SkillsDiscoverCommand, emptySkillsCatalog } from "@acepe/contracts"
import { generateSkillContent } from "./parser.ts"
import { discoverSkillsCatalog, fillSkillsDiscoverCommand } from "./discoverCatalog.ts"
import { SkillsServiceLive } from "./Layers/SkillsService.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const writeAgentSkill = Effect.fn("writeAgentSkill")(function*(
	homeDir: string,
	folderName: string,
	skillName: string,
	description: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const skillDir = path.join(homeDir, ".claude", "skills", folderName)
	yield* fs.makeDirectory(skillDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(skillDir, "SKILL.md"),
		generateSkillContent(skillName, description, `# ${skillName}`)
	)
})

Vitest.layer(PlatformLive)("discoverSkillsCatalog", (it) => {
	it.effect("reads agent skills from the same home-dir paths as SkillsService", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			yield* writeAgentSkill(home, "review", "review", "Review a diff")
			const catalog = yield* discoverSkillsCatalog().pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(SkillsServiceLive({ homeDir: home }))
			)
			const claude = Arr.findFirst(catalog.agentSkills, (row) => row.agentId === "claude-code")
			Vitest.assert.strictEqual(claude._tag, "Some")
			if (claude._tag === "Some") {
				Vitest.assert.strictEqual(claude.value.skills.length, 1)
				Vitest.assert.strictEqual(claude.value.skills[0]?.name, "review")
			}
			Vitest.assert.deepStrictEqual(
				Arr.map(catalog.tree, (node) => node.id),
				["claude-code", "codex", "cursor", "opencode"]
			)
		})
	)
})

Vitest.layer(PlatformLive)("fillSkillsDiscoverCommand", (it) => {
	it.effect("leaves non-discover commands unchanged", () =>
		Effect.gen(function*() {
			const command = ProjectCreateCommand.make({
				type: "project.create",
				commandId: CommandId.make("cmd-project"),
				projectId: ProjectId.make("project-1"),
				title: "Acepe",
				workspaceRoot: "/tmp/acepe"
			})
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const filled = yield* fillSkillsDiscoverCommand(command).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(SkillsServiceLive({ homeDir: home }))
			)
			Vitest.assert.deepStrictEqual(filled, command)
		})
	)

	it.effect("overwrites the command catalog from disk", () =>
		Effect.gen(function*() {
			const command = SkillsDiscoverCommand.make({
				type: "skills.discover",
				commandId: CommandId.make("cmd-1"),
				catalog: emptySkillsCatalog
			})
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			yield* writeAgentSkill(home, "review", "review", "Review a diff")
			const filled = yield* fillSkillsDiscoverCommand(command).pipe(
				// @effect-diagnostics-next-line strictEffectProvide:off
				Effect.provide(SkillsServiceLive({ homeDir: home }))
			)
			Vitest.assert.strictEqual(filled.type, "skills.discover")
			if (filled.type === "skills.discover") {
				const claude = Arr.findFirst(
					filled.catalog.agentSkills,
					(row) => row.agentId === "claude-code"
				)
				Vitest.assert.strictEqual(claude._tag, "Some")
			}
		})
	)
})
