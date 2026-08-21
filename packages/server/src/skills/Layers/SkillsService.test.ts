import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { generateSkillContent } from "../parser.ts"
import { SkillsService } from "../Services/SkillsService.ts"
import { SkillsServiceLive } from "./SkillsService.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const withSkills = <A, E, R>(
	homeDir: string,
	program: Effect.Effect<A, E, R | SkillsService>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(SkillsServiceLive({ homeDir }))
	)

const writeAgentSkill = Effect.fn("writeAgentSkill")(function*(
	homeDir: string,
	agentDir: ReadonlyArray<string>,
	folderName: string,
	skillName: string,
	description: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const skillsDir = Arr.reduce(agentDir, homeDir, (current, segment) =>
		path.join(current, segment)
	)
	const skillDir = path.join(skillsDir, folderName)
	yield* fs.makeDirectory(skillDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(skillDir, "SKILL.md"),
		generateSkillContent(skillName, description, `# ${skillName}`)
	)
})

Vitest.layer(PlatformLive)("SkillsServiceLive", (it) => {
	it.effect("discovers agents from the same home-dir paths as rust", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			yield* writeAgentSkill(
				home,
				[".claude", "skills"],
				"review",
				"review",
				"Review a diff"
			)
			yield* withSkills(
				home,
				Effect.gen(function*() {
					const skills = yield* SkillsService
					const agents = yield* skills.getAgents()
					Vitest.assert.deepStrictEqual(
						Arr.map(agents, (agent) => ({
							id: agent.id,
							exists: agent.exists
						})),
						[
							{ id: "claude-code", exists: true },
							{ id: "codex", exists: false },
							{ id: "cursor", exists: false },
							{ id: "opencode", exists: false }
						]
					)
					Vitest.assert.strictEqual(
						agents[0]?.skillsDir.endsWith("/.claude/skills"),
						true
					)
					const grouped = yield* skills.listAgentSkills()
					const claude = Arr.findFirst(
						grouped,
						(row) => row.agentId === "claude-code"
					)
					Vitest.assert.strictEqual(claude._tag, "Some")
					if (claude._tag === "Some") {
						Vitest.assert.strictEqual(claude.value.skills.length, 1)
						Vitest.assert.strictEqual(claude.value.skills[0]?.name, "review")
						Vitest.assert.strictEqual(claude.value.skills[0]?.id, "claude-code::review")
					}
					const tree = yield* skills.getSkillsTree()
					Vitest.assert.deepStrictEqual(
						Arr.map(tree, (node) => node.id),
						["claude-code", "codex", "cursor", "opencode"]
					)
					const loaded = yield* skills.getSkill("claude-code::review")
					Vitest.assert.strictEqual(loaded.folderName, "review")
				})
			)
		})
	)

	it.effect("puts plugin skills above agents in the tree", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const home = yield* fs.makeTempDirectoryScoped()
			const skillDir = path.join(
				home,
				".claude",
				"plugins",
				"cache",
				"acme",
				"tools",
				"1.0.0",
				"skills",
				"review"
			)
			yield* fs.makeDirectory(skillDir, { recursive: true })
			yield* fs.writeFileString(
				path.join(skillDir, "SKILL.md"),
				generateSkillContent("review", "Plugin review", "# review")
			)
			yield* withSkills(
				home,
				Effect.gen(function*() {
					const skills = yield* SkillsService
					const tree = yield* skills.getSkillsTree()
					Vitest.assert.strictEqual(tree[0]?.id, "plugins")
					Vitest.assert.strictEqual(tree[0]?.nodeType, "plugins-section")
					Vitest.assert.strictEqual(tree[0]?.children[0]?.id, "acme::tools")
				})
			)
		})
	)
})
