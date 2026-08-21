import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { PlatformError } from "effect/PlatformError"
import type * as Schema from "effect/Schema"
import type {
	PluginNotFoundError,
	PluginSkillInvalidIdError,
	PluginSkillNotFoundError,
	SkillInvalidIdError,
	SkillNotFoundError,
	SkillParseError,
	SkillUnknownAgentError
} from "../Errors.ts"
import type {
	AgentSkills,
	PluginInfo,
	PluginSkill,
	Skill,
	SkillAgent,
	SkillTreeNode
} from "../Schemas.ts"

export type SkillsServiceError =
	| SkillParseError
	| SkillUnknownAgentError
	| SkillInvalidIdError
	| SkillNotFoundError
	| PluginNotFoundError
	| PluginSkillInvalidIdError
	| PluginSkillNotFoundError
	| PlatformError
	| Schema.SchemaError

export interface SkillsServiceShape {
	readonly getAgents: () => Effect.Effect<ReadonlyArray<SkillAgent>, SkillsServiceError>
	readonly listAgentSkills: () => Effect.Effect<ReadonlyArray<AgentSkills>, SkillsServiceError>
	readonly listSkillsForAgent: (
		agentId: string
	) => Effect.Effect<ReadonlyArray<Skill>, SkillsServiceError>
	readonly getSkill: (skillId: string) => Effect.Effect<Skill, SkillsServiceError>
	readonly getSkillsTree: () => Effect.Effect<ReadonlyArray<SkillTreeNode>, SkillsServiceError>
	readonly getPlugins: () => Effect.Effect<ReadonlyArray<PluginInfo>, SkillsServiceError>
	readonly listPluginSkills: (
		pluginId: string
	) => Effect.Effect<ReadonlyArray<PluginSkill>, SkillsServiceError>
	readonly getPluginSkill: (skillId: string) => Effect.Effect<PluginSkill, SkillsServiceError>
}

export class SkillsService extends Context.Service<SkillsService, SkillsServiceShape>()(
	"@acepe/server/skills/Services/SkillsService"
) {}
