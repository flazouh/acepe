import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { SkillNotFoundError } from "../Errors.ts"
import { listChildDirectories, modifiedAtMillis } from "../fsWalk.ts"
import { parseSkillContent } from "../parser.ts"
import {
	parseSkillId,
	requireSkillAgentId,
	SKILL_AGENT_ROWS,
	SKILL_FILENAME,
	skillIdFor
} from "../paths.ts"
import { discoverPlugins, getPluginSkill, listPluginSkills } from "../plugins.ts"
import {
	AgentSkills,
	Skill,
	SkillAgent,
	SkillTreeNode,
	type SkillAgentId
} from "../Schemas.ts"
import { SkillsService } from "../Services/SkillsService.ts"

export type SkillsServiceLiveOptions = {
	readonly homeDir: string
}

const decodeAgent = Schema.decodeUnknownEffect(SkillAgent)
const decodeSkill = Schema.decodeUnknownEffect(Skill)
const decodeGrouped = Schema.decodeUnknownEffect(AgentSkills)
const decodeTree = Schema.decodeUnknownEffect(SkillTreeNode)

const joinSegments = (path: Path.Path, root: string, segments: ReadonlyArray<string>): string =>
	Arr.reduce(segments, root, (current, segment) => path.join(current, segment))

const agentSkillsDir = (path: Path.Path, homeDir: string, agentId: SkillAgentId): string => {
	const row = Arr.findFirst(SKILL_AGENT_ROWS, (candidate) => candidate.id === agentId)
	return Option.match(row, {
		onNone: () => homeDir,
		onSome: (value) => joinSegments(path, homeDir, value.dirSegments)
	})
}

const loadSkillFromPath = Effect.fn("SkillsService.loadSkillFromPath")(function*(
	fs: FileSystem.FileSystem,
	skillMdPath: string,
	agentId: SkillAgentId,
	folderName: string
) {
	const content = yield* fs.readFileString(skillMdPath)
	const parsed = parseSkillContent(content)
	if (Result.isFailure(parsed)) {
		return yield* parsed.failure
	}
	const info = yield* fs.stat(skillMdPath)
	return yield* decodeSkill({
		id: skillIdFor(agentId, folderName),
		agentId,
		folderName,
		path: skillMdPath,
		name: parsed.success.metadata.name,
		description: parsed.success.metadata.description,
		content,
		modifiedAt: modifiedAtMillis(info.mtime)
	})
})

export const makeSkillsService = Effect.fn("SkillsService.make")(function*(
	options: SkillsServiceLiveOptions
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path

	const getAgents = Effect.fn("SkillsService.getAgents")(function*() {
		const rows = yield* Effect.forEach(SKILL_AGENT_ROWS, (row) =>
			Effect.gen(function*() {
				const skillsDir = joinSegments(path, options.homeDir, row.dirSegments)
				const exists = yield* fs.exists(skillsDir)
				return yield* decodeAgent({
					id: row.id,
					name: row.name,
					skillsDir,
					exists
				})
			})
		)
		return Arr.sortWith(rows, (agent) => agent.name, Str.Order)
	})

	const listSkillsForAgent = Effect.fn("SkillsService.listSkillsForAgent")(function*(
		agentId: string
	) {
		const decodedId = yield* Effect.fromResult(requireSkillAgentId(agentId))
		const skillsDir = agentSkillsDir(path, options.homeDir, decodedId)
		const folders = yield* listChildDirectories(fs, path, skillsDir)
		const loaded = yield* Effect.forEach(folders, (folder) =>
			Effect.gen(function*() {
				const skillMdPath = path.join(folder.absolute, SKILL_FILENAME)
				const exists = yield* fs.exists(skillMdPath)
				if (exists === false) {
					return Option.none<Skill>()
				}
				const result = yield* Effect.result(
					loadSkillFromPath(fs, skillMdPath, decodedId, folder.name)
				)
				if (Result.isFailure(result)) {
					yield* Effect.logWarning("Failed to load skill")
					return Option.none<Skill>()
				}
				return Option.some(result.success)
			})
		)
		return Arr.getSomes(loaded)
	})

	const listAgentSkills = Effect.fn("SkillsService.listAgentSkills")(function*() {
		const agents = Arr.sortWith(SKILL_AGENT_ROWS, (row) => row.name, Str.Order)
		return yield* Effect.forEach(agents, (row) =>
			Effect.gen(function*() {
				const skills = yield* listSkillsForAgent(row.id)
				return yield* decodeGrouped({
					agentId: row.id,
					skills
				})
			})
		)
	})

	const getSkill = Effect.fn("SkillsService.getSkill")(function*(skillId: string) {
		const parsed = yield* Effect.fromResult(parseSkillId(skillId))
		const agentId = yield* Effect.fromResult(requireSkillAgentId(parsed.agentId))
		const skillMdPath = path.join(
			agentSkillsDir(path, options.homeDir, agentId),
			parsed.folderName,
			SKILL_FILENAME
		)
		const exists = yield* fs.exists(skillMdPath)
		if (exists === false) {
			return yield* new SkillNotFoundError({ skillId })
		}
		return yield* loadSkillFromPath(fs, skillMdPath, agentId, parsed.folderName)
	})

	const getPlugins = Effect.fn("SkillsService.getPlugins")(function*() {
		return yield* discoverPlugins(fs, path, options.homeDir)
	})

	const pluginSkills = Effect.fn("SkillsService.listPluginSkills")(function*(pluginId: string) {
		return yield* listPluginSkills(fs, path, options.homeDir, pluginId)
	})

	const pluginSkill = Effect.fn("SkillsService.getPluginSkill")(function*(skillId: string) {
		return yield* getPluginSkill(fs, path, options.homeDir, skillId)
	})

	const getSkillsTree = Effect.fn("SkillsService.getSkillsTree")(function*() {
		const plugins = yield* getPlugins()
		const pluginChildren =
			plugins.length === 0
				? Arr.empty<SkillTreeNode>()
				: yield* Effect.forEach(plugins, (plugin) =>
						Effect.gen(function*() {
							const skills = yield* pluginSkills(plugin.id)
							const skillChildren = yield* Effect.forEach(skills, (skill) =>
								decodeTree({
									id: skill.id,
									label: skill.name,
									nodeType: "plugin-skill",
									agentId: plugin.id,
									children: Arr.empty(),
									isExpandable: false
								})
							)
							return yield* decodeTree({
								id: plugin.id,
								label: `${plugin.name} (v${plugin.version})`,
								nodeType: "plugin",
								agentId: plugin.id,
								children: skillChildren,
								isExpandable: true
							})
						})
					)
		const pluginSection =
			plugins.length === 0
				? Arr.empty<SkillTreeNode>()
				: Arr.of(
						yield* decodeTree({
							id: "plugins",
							label: "Plugins",
							nodeType: "plugins-section",
							agentId: "plugins",
							children: pluginChildren,
							isExpandable: true
						})
					)
		const agents = Arr.sortWith(SKILL_AGENT_ROWS, (row) => row.name, Str.Order)
		const agentNodes = yield* Effect.forEach(agents, (row) =>
			Effect.gen(function*() {
				const skills = yield* listSkillsForAgent(row.id)
				const children = yield* Effect.forEach(skills, (skill) =>
					decodeTree({
						id: skill.id,
						label: skill.name,
						nodeType: "skill",
						agentId: row.id,
						children: Arr.empty(),
						isExpandable: false
					})
				)
				return yield* decodeTree({
					id: row.id,
					label: row.name,
					nodeType: "agent",
					agentId: row.id,
					children,
					isExpandable: true
				})
			})
		)
		return Arr.appendAll(pluginSection, agentNodes)
	})

	return SkillsService.of({
		getAgents,
		listAgentSkills,
		listSkillsForAgent,
		getSkill,
		getSkillsTree,
		getPlugins,
		listPluginSkills: pluginSkills,
		getPluginSkill: pluginSkill
	})
})

export const SkillsServiceLive = (options: SkillsServiceLiveOptions) =>
	Layer.effect(SkillsService, makeSkillsService(options))
