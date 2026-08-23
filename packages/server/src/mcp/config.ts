import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Path from "effect/Path"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

const McpServersMap = Schema.Record(Schema.String, Schema.Unknown)

const McpConfigFile = Schema.Struct({
	mcpServers: McpServersMap.pipe(Schema.optionalKey),
	mcp_servers: McpServersMap.pipe(Schema.optionalKey)
})

const decodeMcpConfigFile = Schema.decodeUnknownExit(Schema.fromJsonString(McpConfigFile))

const serverHasLaunchTarget = (spec: unknown): boolean => {
	const decoded = Schema.decodeUnknownExit(Schema.Record(Schema.String, Schema.Unknown))(spec)
	if (Exit.isSuccess(decoded) === false) {
		return false
	}
	const command = decoded.value.command
	const url = decoded.value.url
	const hasCommand = Predicate.isString(command) && Str.trim(command) !== ""
	const hasUrl = Predicate.isString(url) && Str.trim(url) !== ""
	return hasCommand || hasUrl
}

const namesFromMap = (servers: Option.Option<typeof McpServersMap.Type>): ReadonlyArray<string> =>
	Option.match(servers, {
		onNone: () => Arr.empty<string>(),
		onSome: (value) =>
			Arr.sort(
				Arr.filter(Rec.keys(value), (name) => serverHasLaunchTarget(value[name])),
				Str.Order
			)
	})

const parseMcpServerNames = (content: string): ReadonlyArray<string> => {
	const decoded = decodeMcpConfigFile(content)
	if (Exit.isSuccess(decoded) === false) {
		return Arr.empty()
	}
	const camel = decoded.value.mcpServers
	if (camel !== undefined) {
		return namesFromMap(Option.some(camel))
	}
	const snake = decoded.value.mcp_servers
	if (snake !== undefined) {
		return namesFromMap(Option.some(snake))
	}
	return Arr.empty()
}

const readMcpServerNamesFromFile = Effect.fn("readMcpServerNamesFromFile")(function*(
	fs: FileSystem.FileSystem,
	filePath: string
) {
	const exists = yield* fs.exists(filePath)
	if (exists === false) {
		return Arr.empty<string>()
	}
	const content = yield* fs.readFileString(filePath)
	return parseMcpServerNames(content)
})

export const projectMcpConfigPaths = (path: Path.Path, projectRoot: string): ReadonlyArray<string> =>
	Arr.fromIterable([
		path.join(projectRoot, ".cursor", "mcp.json"),
		path.join(projectRoot, "mcp.json")
	])

export const userMcpConfigPath = (path: Path.Path, homeDir: string): string =>
	path.join(homeDir, ".cursor", "mcp.json")

export const loadConfiguredMcpServerNames = Effect.fn("loadConfiguredMcpServerNames")(function*(
	fs: FileSystem.FileSystem,
	path: Path.Path,
	projectRoot: string,
	homeDir: string
) {
	const projectPaths = projectMcpConfigPaths(path, projectRoot)
	const userPath = userMcpConfigPath(path, homeDir)
	const first = projectPaths[0]
	const second = projectPaths[1]
	const fromFirst =
		first === undefined ? Arr.empty<string>() : yield* readMcpServerNamesFromFile(fs, first)
	const fromSecond =
		second === undefined ? Arr.empty<string>() : yield* readMcpServerNamesFromFile(fs, second)
	const fromUser = yield* readMcpServerNamesFromFile(fs, userPath)
	return Arr.dedupeAdjacent(
		Arr.sort(Arr.appendAll(Arr.appendAll(fromFirst, fromSecond), fromUser), Str.Order)
	)
})
