import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { APP_SKILLS_ID, emptySkillsCatalog, PluginInfo, ProjectedSkillsCatalog, Skill, SkillAgent, SkillsCatalog } from "./skills.ts"

const decodeAgent = Schema.decodeUnknownEffect(SkillAgent)
const decodeSkill = Schema.decodeUnknownEffect(Skill)
const decodePlugin = Schema.decodeUnknownEffect(PluginInfo)
const decodeCatalog = Schema.decodeUnknownEffect(SkillsCatalog)
const decodeProjected = Schema.decodeUnknownEffect(ProjectedSkillsCatalog)

describe("APP_SKILLS_ID", () => {
	it("is the singleton skills aggregate id", () => {
		expect(String(APP_SKILLS_ID)).toBe("app")
	})
})

describe("SkillAgent", () => {
	it("decodes a home-dir agent row", () => {
		const agent = Effect.runSync(
			decodeAgent({
				id: "claude-code",
				name: "Claude Code",
				skillsDir: "/home/alex/.claude/skills",
				exists: true,
			}),
		)
		expect(agent.id).toBe("claude-code")
		expect(agent.exists).toBe(true)
	})
})

describe("Skill", () => {
	it("decodes a parsed SKILL.md row", () => {
		const skill = Effect.runSync(
			decodeSkill({
				id: "claude-code::review",
				agentId: "claude-code",
				folderName: "review",
				path: "/home/alex/.claude/skills/review/SKILL.md",
				name: "review",
				description: "Review a diff",
				content: "---\nname: \"review\"\n---\n",
				modifiedAt: 0,
			}),
		)
		expect(skill.id).toBe("claude-code::review")
		expect(skill.modifiedAt).toBe(0)
	})
})

describe("PluginInfo", () => {
	it("decodes a plugin cache row", () => {
		const plugin = Effect.runSync(
			decodePlugin({
				id: "acme::tools",
				marketplace: "acme",
				name: "tools",
				version: "1.2.3",
				skillsDir: "/home/alex/.claude/plugins/cache/acme/tools/1.2.3/skills",
				skillCount: 2,
			}),
		)
		expect(plugin.id).toBe("acme::tools")
		expect(plugin.skillCount).toBe(2)
	})
})

describe("SkillsCatalog", () => {
	it("decodes an empty discovery catalog", () => {
		const catalog = Effect.runSync(decodeCatalog(emptySkillsCatalog))
		expect(catalog.agents).toEqual([])
		expect(catalog.tree).toEqual([])
	})

	it("decodes a nested skill tree", () => {
		const catalog = Effect.runSync(
			decodeCatalog({
				agents: [],
				agentSkills: [],
				plugins: [],
				pluginSkills: [],
				tree: [
					{
						id: "claude-code",
						label: "Claude Code",
						nodeType: "agent",
						agentId: "claude-code",
						children: [
							{
								id: "claude-code::review",
								label: "review",
								nodeType: "skill",
								agentId: "claude-code",
								children: [],
								isExpandable: false,
							},
						],
						isExpandable: true,
					},
				],
			}),
		)
		expect(catalog.tree[0]?.children[0]?.id).toBe("claude-code::review")
	})
})

describe("ProjectedSkillsCatalog", () => {
	it("adds the projection sequence to a catalog", () => {
		const projected = Effect.runSync(
			decodeProjected({
				sequence: 4,
				agents: [],
				agentSkills: [],
				plugins: [],
				pluginSkills: [],
				tree: [],
			}),
		)
		expect(projected.sequence).toBe(4)
	})
})
