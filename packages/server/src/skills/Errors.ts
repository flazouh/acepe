import * as Schema from "effect/Schema"

export class SkillParseError extends Schema.TaggedError<SkillParseError>()("SkillParseError", {
	reason: Schema.String
}) {
	override get message(): string {
		return this.reason
	}
}

export class SkillUnknownAgentError extends Schema.TaggedError<SkillUnknownAgentError>()(
	"SkillUnknownAgentError",
	{
		agentId: Schema.String
	}
) {
	override get message(): string {
		return `Unknown agent: ${this.agentId}`
	}
}

export class SkillInvalidIdError extends Schema.TaggedError<SkillInvalidIdError>()(
	"SkillInvalidIdError",
	{
		skillId: Schema.String
	}
) {
	override get message(): string {
		return `Invalid skill ID format: ${this.skillId}`
	}
}

export class SkillNotFoundError extends Schema.TaggedError<SkillNotFoundError>()(
	"SkillNotFoundError",
	{
		skillId: Schema.String
	}
) {
	override get message(): string {
		return `Skill not found: ${this.skillId}`
	}
}

export class PluginNotFoundError extends Schema.TaggedError<PluginNotFoundError>()(
	"PluginNotFoundError",
	{
		pluginId: Schema.String
	}
) {
	override get message(): string {
		return `Plugin not found: ${this.pluginId}`
	}
}

export class PluginSkillInvalidIdError extends Schema.TaggedError<PluginSkillInvalidIdError>()(
	"PluginSkillInvalidIdError",
	{
		skillId: Schema.String
	}
) {
	override get message(): string {
		return `Invalid plugin skill ID format: ${this.skillId}`
	}
}

export class PluginSkillNotFoundError extends Schema.TaggedError<PluginSkillNotFoundError>()(
	"PluginSkillNotFoundError",
	{
		skillId: Schema.String
	}
) {
	override get message(): string {
		return `Plugin skill not found: ${this.skillId}`
	}
}
