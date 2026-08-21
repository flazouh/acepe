import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { AgentSkills, PluginInfo, PluginSkill, Skill, SkillAgent, SkillTreeNode } from "./Schemas.ts"

const decodeAgent = Schema.decodeUnknownSync(SkillAgent)
const decodeSkill = Schema.decodeUnknownSync(Skill)
const decodeGrouped = Schema.decodeUnknownSync(AgentSkills)
const decodeTree = Schema.decodeUnknownSync(SkillTreeNode)
const decodePlugin = Schema.decodeUnknownSync(PluginInfo)
const decodePluginSkill = Schema.decodeUnknownSync(PluginSkill)

Vitest.describe("SkillAgent", () => {
	Vitest.it("decodes a home-dir agent row", () => {
		const agent = decodeAgent({
			id: "claude-code",
			name: "Claude Code",
			skillsDir: "/home/alex/.claude/skills",
			exists: true
		})
		Vitest.assert.strictEqual(agent.id, "claude-code")
		Vitest.assert.strictEqual(agent.exists, true)
	})
})

Vitest.describe("Skill", () => {
	Vitest.it("decodes a parsed SKILL.md row", () => {
		const skill = decodeSkill({
			id: "claude-code::review",
			agentId: "cursor",
			folderName: "review",
			path: "/home/alex/.cursor/skills/review/SKILL.md",
			name: "review",
			description: "Review a diff",
			content: "---\nname: \"review\"\n---\n",
			modifiedAt: 0
		})
		Vitest.assert.strictEqual(skill.id, "claude-code::review")
		Vitest.assert.strictEqual(skill.agentId, "cursor")
		Vitest.assert.strictEqual(skill.modifiedAt, 0)
	})
})

Vitest.describe("AgentSkills", () => {
	Vitest.it("groups skills by agent id", () => {
		const grouped = decodeGrouped({
			agentId: "codex",
			skills: []
		})
		Vitest.assert.strictEqual(grouped.agentId, "codex")
		Vitest.assert.strictEqual(grouped.skills.length, 0)
	})
})

Vitest.describe("SkillTreeNode", () => {
	Vitest.it("decodes an expandable agent node", () => {
		const node = decodeTree({
			id: "claude-code",
			label: "Claude Code",
			nodeType: "agent",
			agentId: "claude-code",
			children: [],
			isExpandable: true
		})
		Vitest.assert.strictEqual(node.nodeType, "agent")
		Vitest.assert.strictEqual(node.isExpandable, true)
	})
})

Vitest.describe("PluginInfo", () => {
	Vitest.it("decodes a plugin cache row", () => {
		const plugin = decodePlugin({
			id: "acme::tools",
			marketplace: "acme",
			name: "tools",
			version: "1.2.3",
			skillsDir: "/home/alex/.claude/plugins/cache/acme/tools/1.2.3/skills",
			skillCount: 2
		})
		Vitest.assert.strictEqual(plugin.id, "acme::tools")
		Vitest.assert.strictEqual(plugin.skillCount, 2)
	})
})

Vitest.describe("PluginSkill", () => {
	Vitest.it("decodes a plugin skill with a three-part id", () => {
		const skill = decodePluginSkill({
			id: "acme::tools::review",
			pluginId: "acme::tools",
			folderName: "review",
			path: "/tmp/SKILL.md",
			name: "review",
			description: "",
			content: "---\nname: \"review\"\n---\n",
			modifiedAt: 1
		})
		Vitest.assert.strictEqual(skill.id, "acme::tools::review")
	})
})
