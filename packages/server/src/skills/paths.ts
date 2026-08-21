import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { PluginSkillInvalidIdError, SkillInvalidIdError, SkillUnknownAgentError } from "./Errors.ts"
import { SkillAgentId, type SkillAgentId as SkillAgentIdType } from "./Schemas.ts"

export const SKILL_FILENAME = "SKILL.md"

export const SKILL_AGENT_ROWS = [
	{
		id: "claude-code",
		name: "Claude Code",
		dirSegments: [".claude", "skills"]
	},
	{
		id: "cursor",
		name: "Cursor",
		dirSegments: [".cursor", "skills"]
	},
	{
		id: "codex",
		name: "Codex",
		dirSegments: [".codex", "skills"]
	},
	{
		id: "opencode",
		name: "OpenCode",
		dirSegments: [".opencode", "skills"]
	}
] as const

export const PLUGIN_CACHE_SEGMENTS = [".claude", "plugins", "cache"] as const

export const skillIdFor = (agentId: string, folderName: string): string => `${agentId}::${folderName}`

export const pluginIdFor = (marketplace: string, pluginName: string): string =>
	`${marketplace}::${pluginName}`

export const pluginSkillIdFor = (pluginId: string, folderName: string): string =>
	`${pluginId}::${folderName}`

export const relativeSkillsDir = (agentId: SkillAgentIdType): string =>
	Option.match(findSkillAgentRow(agentId), {
		onNone: () => "",
		onSome: (row) => Arr.join(row.dirSegments, "/")
	})

export const relativePluginCacheDir = (): string => Arr.join(PLUGIN_CACHE_SEGMENTS, "/")

export const findSkillAgentRow = (
	agentId: SkillAgentIdType
): Option.Option<(typeof SKILL_AGENT_ROWS)[number]> =>
	Arr.findFirst(SKILL_AGENT_ROWS, (row) => row.id === agentId)

export const requireSkillAgentId = (
	agentId: string
): Result.Result<SkillAgentIdType, SkillUnknownAgentError> => {
	if (Schema.is(SkillAgentId)(agentId)) {
		return Result.succeed(agentId)
	}
	return Result.fail(new SkillUnknownAgentError({ agentId }))
}

export const parseSkillId = (
	skillId: string
): Result.Result<{ readonly agentId: string; readonly folderName: string }, SkillInvalidIdError> => {
	const parts = Str.split(skillId, "::")
	if (parts.length !== 2) {
		return Result.fail(new SkillInvalidIdError({ skillId }))
	}
	const agentId = parts[0]
	const folderName = parts[1]
	if (agentId === undefined || folderName === undefined || folderName.length === 0) {
		return Result.fail(new SkillInvalidIdError({ skillId }))
	}
	return Result.succeed({
		agentId,
		folderName
	})
}

export const parsePluginSkillId = (
	skillId: string
): Result.Result<
	{ readonly pluginId: string; readonly folderName: string },
	PluginSkillInvalidIdError
> => {
	const parts = Str.split(skillId, "::")
	if (parts.length !== 3) {
		return Result.fail(new PluginSkillInvalidIdError({ skillId }))
	}
	const marketplace = parts[0]
	const pluginName = parts[1]
	const folderName = parts[2]
	if (
		marketplace === undefined ||
		pluginName === undefined ||
		folderName === undefined ||
		marketplace.length === 0 ||
		pluginName.length === 0 ||
		folderName.length === 0
	) {
		return Result.fail(new PluginSkillInvalidIdError({ skillId }))
	}
	return Result.succeed({
		pluginId: pluginIdFor(marketplace, pluginName),
		folderName
	})
}
