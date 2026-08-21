import * as Vitest from "@effect/vitest"
import * as Result from "effect/Result"
import {
	parsePluginSkillId,
	parseSkillId,
	PLUGIN_CACHE_SEGMENTS,
	relativePluginCacheDir,
	relativeSkillsDir,
	requireSkillAgentId,
	SKILL_AGENT_ROWS,
	SKILL_FILENAME
} from "./paths.ts"

Vitest.describe("skill discovery paths", () => {
	Vitest.it("uses the same home-dir skills folders as the rust service", () => {
		Vitest.assert.strictEqual(SKILL_FILENAME, "SKILL.md")
		Vitest.assert.deepStrictEqual(
			SKILL_AGENT_ROWS.map((row) => ({
				id: row.id,
				name: row.name,
				dir: relativeSkillsDir(row.id)
			})),
			[
				{ id: "claude-code", name: "Claude Code", dir: ".claude/skills" },
				{ id: "cursor", name: "Cursor", dir: ".cursor/skills" },
				{ id: "codex", name: "Codex", dir: ".codex/skills" },
				{ id: "opencode", name: "OpenCode", dir: ".opencode/skills" }
			]
		)
		Vitest.assert.deepStrictEqual(PLUGIN_CACHE_SEGMENTS, [".claude", "plugins", "cache"])
		Vitest.assert.strictEqual(relativePluginCacheDir(), ".claude/plugins/cache")
	})
})

Vitest.describe("parseSkillId", () => {
	Vitest.it("splits agent and folder on a two-part id", () => {
		const parsed = parseSkillId("claude-code::review")
		Vitest.assert.strictEqual(Result.isSuccess(parsed), true)
		if (Result.isSuccess(parsed)) {
			Vitest.assert.strictEqual(parsed.success.agentId, "claude-code")
			Vitest.assert.strictEqual(parsed.success.folderName, "review")
		}
	})

	Vitest.it("rejects a three-part plugin id", () => {
		const parsed = parseSkillId("acme::tools::review")
		Vitest.assert.strictEqual(Result.isFailure(parsed), true)
	})
})

Vitest.describe("requireSkillAgentId", () => {
	Vitest.it("rejects agents the rust service does not scan", () => {
		const parsed = requireSkillAgentId("forge")
		Vitest.assert.strictEqual(Result.isFailure(parsed), true)
		if (Result.isFailure(parsed)) {
			Vitest.assert.strictEqual(parsed.failure._tag, "SkillUnknownAgentError")
		}
	})
})

Vitest.describe("parsePluginSkillId", () => {
	Vitest.it("splits marketplace, plugin, and folder", () => {
		const parsed = parsePluginSkillId("acme::tools::review")
		Vitest.assert.strictEqual(Result.isSuccess(parsed), true)
		if (Result.isSuccess(parsed)) {
			Vitest.assert.strictEqual(parsed.success.pluginId, "acme::tools")
			Vitest.assert.strictEqual(parsed.success.folderName, "review")
		}
	})
})
