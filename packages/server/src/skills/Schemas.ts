import { TrimmedNonEmptyString } from "@acepe/contracts"
import * as Schema from "effect/Schema"

export {
	AgentSkills,
	PluginInfo,
	PluginSkill,
	Skill,
	SkillAgent,
	SkillAgentId,
	SkillTreeNode
} from "@acepe/contracts"

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
