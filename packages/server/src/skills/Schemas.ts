import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const SkillAgentId = Schema.Literals(["claude-code", "cursor", "codex", "opencode"])
export type SkillAgentId = typeof SkillAgentId.Type

export const SkillAgent = Schema.Struct({
	id: SkillAgentId,
	name: TrimmedNonEmptyString,
	skillsDir: TrimmedNonEmptyString,
	exists: Schema.Boolean
})
export type SkillAgent = typeof SkillAgent.Type

export const Skill = Schema.Struct({
	id: TrimmedNonEmptyString,
	agentId: SkillAgentId,
	folderName: TrimmedNonEmptyString,
	path: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	description: Schema.String,
	content: Schema.String,
	modifiedAt: NonNegativeInt
})
export type Skill = typeof Skill.Type

export const AgentSkills = Schema.Struct({
	agentId: SkillAgentId,
	skills: Schema.Array(Skill)
})
export type AgentSkills = typeof AgentSkills.Type

export interface SkillTreeNode {
	readonly id: TrimmedNonEmptyString
	readonly label: TrimmedNonEmptyString
	readonly nodeType: TrimmedNonEmptyString
	readonly agentId: TrimmedNonEmptyString
	readonly children: ReadonlyArray<SkillTreeNode>
	readonly isExpandable: boolean
}

export const SkillTreeNode: Schema.Codec<SkillTreeNode> = Schema.Struct({
	id: TrimmedNonEmptyString,
	label: TrimmedNonEmptyString,
	nodeType: TrimmedNonEmptyString,
	agentId: TrimmedNonEmptyString,
	children: Schema.Array(Schema.suspend((): Schema.Codec<SkillTreeNode> => SkillTreeNode)),
	isExpandable: Schema.Boolean
})

export const PluginInfo = Schema.Struct({
	id: TrimmedNonEmptyString,
	marketplace: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	version: TrimmedNonEmptyString,
	skillsDir: TrimmedNonEmptyString,
	skillCount: NonNegativeInt
})
export type PluginInfo = typeof PluginInfo.Type

export const PluginSkill = Schema.Struct({
	id: TrimmedNonEmptyString,
	pluginId: TrimmedNonEmptyString,
	folderName: TrimmedNonEmptyString,
	path: TrimmedNonEmptyString,
	name: TrimmedNonEmptyString,
	description: Schema.String,
	content: Schema.String,
	modifiedAt: NonNegativeInt
})
export type PluginSkill = typeof PluginSkill.Type

export const SkillMetadata = Schema.Struct({
	name: TrimmedNonEmptyString,
	description: Schema.String
})
export type SkillMetadata = typeof SkillMetadata.Type

export const ParsedSkillContent = Schema.Struct({
	metadata: SkillMetadata,
	body: Schema.String
})
export type ParsedSkillContent = typeof ParsedSkillContent.Type
