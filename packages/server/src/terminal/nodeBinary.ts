import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"

export const DEFAULT_NODE_BINARY = "node"

export const DEFAULT_NODE_BINARY_CANDIDATES: ReadonlyArray<string> = [
	"/opt/homebrew/bin/node",
	"/usr/local/bin/node",
	"/usr/bin/node"
]

export const isBunNodeShimPath = (filePath: string): boolean =>
	filePath.includes("/.bun/") ||
	filePath.includes("\\bun\\") ||
	filePath.includes("bun-node-")

export const nodeBinaryFromHome = (home: string): string => `${home}/.hermes/node/bin/node`

export const nodeBinaryFromPathVariable = (pathVariable: string): ReadonlyArray<string> => {
	const separator = pathVariable.includes(";") ? ";" : ":"
	const parts = pathVariable.split(separator)
	const out: Array<string> = []
	for (const dir of parts) {
		if (dir.length === 0) {
			continue
		}
		const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`
		const candidate = `${prefix}node`
		if (isBunNodeShimPath(candidate) === false) {
			out.push(candidate)
		}
	}
	return out
}

export const collectNodeBinaryCandidates = (
	home: Option.Option<string>,
	pathVariable: Option.Option<string>
): ReadonlyArray<string> => {
	const out: Array<string> = []
	const seen: { [key: string]: true } = {}
	const push = (filePath: string): void => {
		if (isBunNodeShimPath(filePath) === true) {
			return
		}
		if (seen[filePath] === true) {
			return
		}
		seen[filePath] = true
		out.push(filePath)
	}
	if (Option.isSome(home)) {
		push(nodeBinaryFromHome(home.value))
	}
	if (Option.isSome(pathVariable)) {
		for (const filePath of nodeBinaryFromPathVariable(pathVariable.value)) {
			push(filePath)
		}
	}
	for (const filePath of DEFAULT_NODE_BINARY_CANDIDATES) {
		push(filePath)
	}
	return out
}

export const pickNodeBinary = (
	configured: Option.Option<string>,
	existing: ReadonlyArray<string>
): string => {
	if (
		Option.isSome(configured) &&
		configured.value.length > 0 &&
		isBunNodeShimPath(configured.value) === false
	) {
		return configured.value
	}
	const first = existing[0]
	if (first !== undefined) {
		return first
	}
	return DEFAULT_NODE_BINARY
}

const envOption = (name: string) =>
	Config.option(Config.string(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

export const resolveNodeBinary = Effect.fn("resolveNodeBinary")(function*() {
	const fs = yield* FileSystem.FileSystem
	const configured = yield* envOption("ACEPE_NODE_BINARY")
	if (
		Option.isSome(configured) &&
		configured.value.length > 0 &&
		isBunNodeShimPath(configured.value) === false
	) {
		return configured.value
	}
	const home = yield* envOption("HOME")
	const pathVariable = yield* envOption("PATH")
	const candidates = collectNodeBinaryCandidates(home, pathVariable)
	const existing: Array<string> = []
	for (const candidate of candidates) {
		const present = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))
		if (present === true) {
			existing.push(candidate)
		}
	}
	return pickNodeBinary(Option.none(), existing)
})
