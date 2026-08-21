import { IsoDateTime } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type { PlatformError } from "effect/PlatformError"
import * as Schema from "effect/Schema"
import type { HttpClientError } from "effect/unstable/http/HttpClientError"
import { type AgentJson, type PlatformKey, Sha256Hex } from "../agentJson.ts"
import { ProviderId } from "./ProviderAdapter.ts"

export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()("AgentNotFoundError", {
	agentId: ProviderId
}) {
	override get message(): string {
		return `Agent '${this.agentId}' was not in the ACP registry or the local override catalog.`
	}
}

export class NoBinaryDistributionError extends Schema.TaggedError<NoBinaryDistributionError>()(
	"NoBinaryDistributionError",
	{
		agentId: ProviderId,
		platform: Schema.String
	}
) {
	override get message(): string {
		return `Agent '${this.agentId}' has no binary distribution for platform '${this.platform}'.`
	}
}

export class ChecksumMissingError extends Schema.TaggedError<ChecksumMissingError>()("ChecksumMissingError", {
	agentId: ProviderId,
	archiveUrl: Schema.String
}) {
	override get message(): string {
		return `Agent '${this.agentId}' archive '${this.archiveUrl}' has no sha256; refusing to download.`
	}
}

export class ChecksumMismatchError extends Schema.TaggedError<ChecksumMismatchError>()("ChecksumMismatchError", {
	agentId: ProviderId,
	expected: Schema.String,
	actual: Schema.String
}) {
	override get message(): string {
		return `Agent '${this.agentId}' archive checksum mismatch: expected ${this.expected}, got ${this.actual}.`
	}
}

export class DownloadUrlNotAllowedError extends Schema.TaggedError<DownloadUrlNotAllowedError>()(
	"DownloadUrlNotAllowedError",
	{
		url: Schema.String
	}
) {
	override get message(): string {
		return `Download URL is not in the allowlist: ${this.url}.`
	}
}

export class DownloadTooLargeError extends Schema.TaggedError<DownloadTooLargeError>()("DownloadTooLargeError", {
	url: Schema.String,
	byteLength: Schema.Number
}) {
	override get message(): string {
		return `Download '${this.url}' is ${this.byteLength} bytes, which is over the size limit.`
	}
}

export class UnsafeArchivePathError extends Schema.TaggedError<UnsafeArchivePathError>()("UnsafeArchivePathError", {
	agentId: ProviderId,
	cmd: Schema.String
}) {
	override get message(): string {
		return `Agent '${this.agentId}' cmd '${this.cmd}' is not a safe relative path.`
	}
}

export class ClaudeVersionParseError extends Schema.TaggedError<ClaudeVersionParseError>()(
	"ClaudeVersionParseError",
	{
		binaryPath: Schema.String,
		stdout: Schema.String
	}
) {
	override get message(): string {
		return `Could not parse claude --version output at '${this.binaryPath}': ${this.stdout}.`
	}
}

export class UnsupportedArchiveError extends Schema.TaggedError<UnsupportedArchiveError>()(
	"UnsupportedArchiveError",
	{
		archiveUrl: Schema.String
	}
) {
	override get message(): string {
		return `Unsupported archive format: ${this.archiveUrl}.`
	}
}

export const AgentDistributionPlan = Schema.Struct({
	agentId: ProviderId,
	version: Schema.String,
	platform: Schema.String,
	archiveUrl: Schema.String,
	sha256: Sha256Hex,
	cmd: Schema.String,
	args: Schema.Array(Schema.String),
	source: Schema.Literals(["registry", "local-override"])
})
export type AgentDistributionPlan = typeof AgentDistributionPlan.Type

export const InstalledAgent = Schema.Struct({
	agentId: ProviderId,
	version: Schema.String,
	binaryPath: Schema.String,
	args: Schema.Array(Schema.String)
})
export type InstalledAgent = typeof InstalledAgent.Type

export const EnsureLatestOutcome = Schema.Literals(["installed", "updated", "already-current"])
export type EnsureLatestOutcome = typeof EnsureLatestOutcome.Type

export const EnsureLatestResult = Schema.Struct({
	outcome: EnsureLatestOutcome,
	agent: InstalledAgent,
	previousVersion: Schema.NullOr(Schema.String)
})
export type EnsureLatestResult = typeof EnsureLatestResult.Type

export const AgentMeta = Schema.Struct({
	version: Schema.String,
	archive_url: Schema.String,
	sha256: Sha256Hex,
	downloaded_at: IsoDateTime,
	cmd: Schema.String,
	args: Schema.Array(Schema.String)
})
export type AgentMeta = typeof AgentMeta.Type
export const encodeAgentMetaJson = Schema.encodeEffect(Schema.fromJsonString(AgentMeta))

export type AgentInstallerError =
	| AgentNotFoundError
	| NoBinaryDistributionError
	| ChecksumMissingError
	| ChecksumMismatchError
	| DownloadUrlNotAllowedError
	| DownloadTooLargeError
	| UnsafeArchivePathError
	| ClaudeVersionParseError
	| UnsupportedArchiveError
	| Schema.SchemaError
	| HttpClientError
	| PlatformError

export interface AgentInstallerShape {
	readonly resolveDistribution: (
		agentId: ProviderId
	) => Effect.Effect<AgentDistributionPlan, AgentInstallerError>
	readonly install: (agentId: ProviderId) => Effect.Effect<InstalledAgent, AgentInstallerError>
	readonly ensureLatest: (
		agentId: ProviderId
	) => Effect.Effect<EnsureLatestResult, AgentInstallerError>
	readonly getCached: (
		agentId: ProviderId
	) => Effect.Effect<Option.Option<InstalledAgent>, Schema.SchemaError | PlatformError>
	readonly uninstall: (agentId: ProviderId) => Effect.Effect<void, PlatformError>
}

export class AgentInstaller extends Context.Service<AgentInstaller, AgentInstallerShape>()(
	"@acepe/server/provider/Services/AgentInstaller"
) {}

export type AgentInstallerLiveOptions = {
	readonly cacheDir: string
	readonly platform: PlatformKey
	readonly registryUrl: string
	readonly localOverrides: ReadonlyArray<AgentJson>
}

export const ALLOWED_DOWNLOAD_URL_PREFIXES = [
	"https://cdn.agentclientprotocol.com/",
	"https://github.com/",
	"https://downloads.cursor.com/",
	"https://release-assets.githubusercontent.com/",
	"https://objects.githubusercontent.com/"
] as const
