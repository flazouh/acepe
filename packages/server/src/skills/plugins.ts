import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import { PluginNotFoundError, PluginSkillNotFoundError } from "./Errors.ts"
import { listChildDirectories, modifiedAtMillis } from "./fsWalk.ts"
import { parseSkillContent } from "./parser.ts"
import {
	parsePluginSkillId,
	PLUGIN_CACHE_SEGMENTS,
	pluginIdFor,
	pluginSkillIdFor,
	SKILL_FILENAME
} from "./paths.ts"
import { latestPluginVersion } from "./pluginVersions.ts"
import { PluginInfo, PluginSkill } from "./Schemas.ts"

const decodePlugin = Schema.decodeUnknownEffect(PluginInfo)
const decodePluginSkill = Schema.decodeUnknownEffect(PluginSkill)

const joinSegments = (path: Path.Path, root: string, segments: ReadonlyArray<string>): string =>
	Arr.reduce(segments, root, (current, segment) => path.join(current, segment))

const pluginCacheDir = (homeDir: string, path: Path.Path): string =>
	joinSegments(path, homeDir, PLUGIN_CACHE_SEGMENTS)

const countSkills = Effect.fn("countPluginSkills")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	skillsDir: string
) {
	const folders = yield* listChildDirectories(fs, path, skillsDir)
	const flags = yield* Effect.forEach(folders, (folder) =>
		fs.exists(path.join(folder.absolute, SKILL_FILENAME))
	)
	return Arr.reduce(flags, 0, (count, exists) => (exists ? count + 1 : count))
})

const loadPluginSkillFromPath = Effect.fn("loadPluginSkillFromPath")(function*(
	fs: FileSystem.FileSystem,
	skillMdPath: string,
	pluginId: string,
	folderName: string
) {
	const content = yield* fs.readFileString(skillMdPath)
	const parsed = parseSkillContent(content)
	if (Result.isFailure(parsed)) {
		return yield* parsed.failure
	}
	const info = yield* fs.stat(skillMdPath)
	return yield* decodePluginSkill({
		id: pluginSkillIdFor(pluginId, folderName),
		pluginId,
		folderName,
		path: skillMdPath,
		name: parsed.success.metadata.name,
		description: parsed.success.metadata.description,
		content,
		modifiedAt: modifiedAtMillis(info.mtime)
	})
})

export const discoverPlugins = Effect.fn("discoverPlugins")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string
) {
	const cacheDir = pluginCacheDir(homeDir, path)
	const marketplaces = yield* listChildDirectories(fs, path, cacheDir)
	const nested = yield* Effect.forEach(marketplaces, (marketplace) =>
		Effect.gen(function*() {
			const pluginDirs = yield* listChildDirectories(fs, path, marketplace.absolute)
			const discovered = yield* Effect.forEach(pluginDirs, (pluginDir) =>
				Effect.gen(function*() {
					const versions = Arr.map(
						yield* listChildDirectories(fs, path, pluginDir.absolute),
						(row) => row.name
					)
					const latest = latestPluginVersion(versions)
					if (Option.isNone(latest)) {
						return Option.none<PluginInfo>()
					}
					const skillsDir = path.join(pluginDir.absolute, latest.value, "skills")
					const exists = yield* fs.exists(skillsDir)
					if (exists === false) {
						return Option.none<PluginInfo>()
					}
					const skillCount = yield* countSkills(fs, path, skillsDir)
					const plugin = yield* decodePlugin({
						id: pluginIdFor(marketplace.name, pluginDir.name),
						marketplace: marketplace.name,
						name: pluginDir.name,
						version: latest.value,
						skillsDir,
						skillCount
					})
					return Option.some(plugin)
				})
			)
			return Arr.getSomes(discovered)
		})
	)
	return Arr.sortWith(Arr.flatten(nested), (plugin) => plugin.name, Str.Order)
})

export const listPluginSkills = Effect.fn("listPluginSkills")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
	pluginId: string
) {
	const plugins = yield* discoverPlugins(fs, path, homeDir)
	const plugin = Arr.findFirst(plugins, (row) => row.id === pluginId)
	if (Option.isNone(plugin)) {
		return yield* new PluginNotFoundError({ pluginId })
	}
	const folders = yield* listChildDirectories(fs, path, plugin.value.skillsDir)
	const loaded = yield* Effect.forEach(folders, (folder) =>
		Effect.gen(function*() {
			const skillMdPath = path.join(folder.absolute, SKILL_FILENAME)
			const exists = yield* fs.exists(skillMdPath)
			if (exists === false) {
				return Option.none<PluginSkill>()
			}
			const result = yield* Effect.result(
				loadPluginSkillFromPath(fs, skillMdPath, pluginId, folder.name)
			)
			if (Result.isFailure(result)) {
				yield* Effect.logWarning("Failed to load plugin skill")
				return Option.none<PluginSkill>()
			}
			return Option.some(result.success)
		})
	)
	return Arr.getSomes(loaded)
})

export const getPluginSkill = Effect.fn("getPluginSkill")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	homeDir: string,
	skillId: string
) {
	const parsedId = yield* Effect.fromResult(parsePluginSkillId(skillId))
	const plugins = yield* discoverPlugins(fs, path, homeDir)
	const plugin = Arr.findFirst(plugins, (row) => row.id === parsedId.pluginId)
	if (Option.isNone(plugin)) {
		return yield* new PluginNotFoundError({ pluginId: parsedId.pluginId })
	}
	const skillMdPath = path.join(plugin.value.skillsDir, parsedId.folderName, SKILL_FILENAME)
	const exists = yield* fs.exists(skillMdPath)
	if (exists === false) {
		return yield* new PluginSkillNotFoundError({ skillId })
	}
	return yield* loadPluginSkillFromPath(fs, skillMdPath, parsedId.pluginId, parsedId.folderName)
})
