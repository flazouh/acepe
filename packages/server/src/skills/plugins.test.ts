import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import { generateSkillContent } from "./parser.ts"
import { discoverPlugins, getPluginSkill, listPluginSkills } from "./plugins.ts"

const PlatformLive = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

const writePluginSkill = Effect.fn("writePluginSkill")(function*(
	homeDir: string,
	marketplace: string,
	pluginName: string,
	version: string,
	folderName: string,
	skillName: string
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const skillDir = path.join(
		homeDir,
		".claude",
		"plugins",
		"cache",
		marketplace,
		pluginName,
		version,
		"skills",
		folderName
	)
	yield* fs.makeDirectory(skillDir, { recursive: true })
	yield* fs.writeFileString(
		path.join(skillDir, "SKILL.md"),
		generateSkillContent(skillName, "From plugin", `# ${skillName}`)
	)
})

Vitest.layer(PlatformLive)("discoverPlugins", (it) => {
	it.effect("reads ~/.claude/plugins/cache and keeps the latest version with skills", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const home = yield* fs.makeTempDirectoryScoped()
			yield* writePluginSkill(home, "acme", "tools", "1.0.0", "old", "old-skill")
			yield* writePluginSkill(home, "acme", "tools", "1.2.0", "review", "review")
			yield* fs.makeDirectory(
				path.join(home, ".claude", "plugins", "cache", "acme", "empty", "1.0.0"),
				{ recursive: true }
			)
			const plugins = yield* discoverPlugins(fs, path, home)
			Vitest.assert.strictEqual(plugins.length, 1)
			Vitest.assert.strictEqual(plugins[0]?.id, "acme::tools")
			Vitest.assert.strictEqual(plugins[0]?.version, "1.2.0")
			Vitest.assert.strictEqual(plugins[0]?.skillCount, 1)
			const skills = yield* listPluginSkills(fs, path, home, "acme::tools")
			Vitest.assert.deepStrictEqual(
				Arr.map(skills, (skill) => skill.folderName),
				["review"]
			)
			const skill = yield* getPluginSkill(fs, path, home, "acme::tools::review")
			Vitest.assert.strictEqual(skill.name, "review")
		})
	)
})
