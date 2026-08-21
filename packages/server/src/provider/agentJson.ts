import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as Schema from "effect/Schema"
import { ProviderId } from "./Services/ProviderAdapter.ts"

export const DEFAULT_REGISTRY_URL =
	"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"

export const PLATFORM_KEYS = [
	"darwin-aarch64",
	"darwin-x86_64",
	"linux-aarch64",
	"linux-x86_64",
	"windows-aarch64",
	"windows-x86_64"
] as const

export const PlatformKey = Schema.Literals(PLATFORM_KEYS)
export type PlatformKey = typeof PlatformKey.Type
export const decodePlatformKey = Schema.decodeUnknownEffect(PlatformKey)

export const Sha256Hex = Schema.String.check(Schema.isPattern(/^[a-fA-F0-9]{64}$/))
export type Sha256Hex = typeof Sha256Hex.Type

export const BinaryTarget = Schema.Struct({
	archive: Schema.String,
	cmd: Schema.String,
	args: Schema.Array(Schema.String).pipe(Schema.optionalKey),
	sha256: Schema.optionalKey(Sha256Hex)
})
export type BinaryTarget = typeof BinaryTarget.Type

export const PackageDistribution = Schema.Struct({
	package: Schema.String,
	args: Schema.Array(Schema.String).pipe(Schema.optionalKey)
})
export type PackageDistribution = typeof PackageDistribution.Type

export const AgentDistribution = Schema.Struct({
	binary: Schema.optionalKey(Schema.Record(Schema.String, BinaryTarget)),
	npx: Schema.optionalKey(PackageDistribution),
	uvx: Schema.optionalKey(PackageDistribution)
})
export type AgentDistribution = typeof AgentDistribution.Type

export const AgentJson = Schema.Struct({
	id: Schema.String,
	name: Schema.optionalKey(Schema.String),
	version: Schema.String,
	distribution: AgentDistribution
})
export type AgentJson = typeof AgentJson.Type
export const decodeAgentJson = Schema.decodeUnknownEffect(AgentJson)

export const Registry = Schema.Struct({
	version: Schema.String,
	agents: Schema.Array(AgentJson)
})
export type Registry = typeof Registry.Type
export const decodeRegistry = Schema.decodeUnknownEffect(Registry)
export const encodeRegistryJson = Schema.encodeEffect(Schema.fromJsonString(Registry))

export const AGENT_JSON_SOURCE = ["registry", "local-override"] as const
export const AgentJsonSource = Schema.Literals(AGENT_JSON_SOURCE)
export type AgentJsonSource = typeof AgentJsonSource.Type

export type ResolvedAgentJson = {
	readonly agent: AgentJson
	readonly source: AgentJsonSource
}

export const findAgentJson = (
	registryAgents: ReadonlyArray<AgentJson>,
	localOverrides: ReadonlyArray<AgentJson>,
	agentId: ProviderId
): Option.Option<ResolvedAgentJson> => {
	const fromRegistry = Arr.findFirst(registryAgents, (agent) => agent.id === agentId)
	if (Option.isSome(fromRegistry)) {
		return Option.some({
			agent: fromRegistry.value,
			source: "registry"
		})
	}
	const fromOverride = Arr.findFirst(localOverrides, (agent) => agent.id === agentId)
	if (Option.isSome(fromOverride)) {
		return Option.some({
			agent: fromOverride.value,
			source: "local-override"
		})
	}
	return Option.none()
}

export const binaryTargetForPlatform = (
	agent: AgentJson,
	platform: PlatformKey
): Option.Option<BinaryTarget> => {
	if (agent.distribution.binary === undefined) {
		return Option.none()
	}
	return Rec.get(agent.distribution.binary, platform)
}

export const relativeCmd = (cmd: string): string => {
	if (cmd.startsWith("./")) {
		return cmd.slice(2)
	}
	return cmd
}

export const checksumEquals = (expected: string, actual: string): boolean =>
	expected.toLowerCase() === actual.toLowerCase()

export const platformKeyFromHost = (os: string, arch: string): Option.Option<PlatformKey> => {
	if (os === "darwin" && (arch === "arm64" || arch === "aarch64")) {
		return Option.some("darwin-aarch64")
	}
	if (os === "darwin" && (arch === "x64" || arch === "x86_64")) {
		return Option.some("darwin-x86_64")
	}
	if (os === "linux" && (arch === "arm64" || arch === "aarch64")) {
		return Option.some("linux-aarch64")
	}
	if (os === "linux" && (arch === "x64" || arch === "x86_64")) {
		return Option.some("linux-x86_64")
	}
	if ((os === "win32" || os === "windows") && (arch === "arm64" || arch === "aarch64")) {
		return Option.some("windows-aarch64")
	}
	if ((os === "win32" || os === "windows") && (arch === "x64" || arch === "x86_64")) {
		return Option.some("windows-x86_64")
	}
	return Option.none()
}
