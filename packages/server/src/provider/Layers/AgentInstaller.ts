import { IsoDateTime } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Crypto from "effect/Crypto"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	binaryTargetForPlatform,
	checksumEquals,
	DEFAULT_REGISTRY_URL,
	findAgentJson,
	type PlatformKey,
	Registry,
	relativeCmd
} from "../agentJson.ts"
import { parseClaudeVersion } from "../claudeVersion.ts"
import { defaultLocalOverrides } from "../localOverrides.ts"
import { ProviderId } from "../Services/ProviderAdapter.ts"
import {
	ALLOWED_DOWNLOAD_URL_PREFIXES,
	AgentInstaller,
	type AgentInstallerLiveOptions,
	AgentMeta,
	AgentNotFoundError,
	ChecksumMismatchError,
	ChecksumMissingError,
	ClaudeVersionParseError,
	DownloadTooLargeError,
	DownloadUrlNotAllowedError,
	encodeAgentMetaJson,
	NoBinaryDistributionError,
	UnsafeArchivePathError,
	UnsupportedArchiveError
} from "../Services/AgentInstaller.ts"

const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024
const CLAUDE_CODE_ID = ProviderId.make("claude-code")
const decodeIsoDateTime = Schema.decodeUnknownEffect(IsoDateTime)
const decodeMetaJson = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentMeta))

const isAllowedDownloadUrl = (url: string): boolean =>
	Arr.some(ALLOWED_DOWNLOAD_URL_PREFIXES, (prefix) => url.startsWith(prefix))

const cmdEscapesInstallDir = (cmd: string): boolean => relativeCmd(cmd).includes("..")

const packedArchiveKind = (archiveUrl: string): Option.Option<"tar.gz" | "tar.bz2" | "zip"> => {
	if (archiveUrl.endsWith(".tar.gz") || archiveUrl.endsWith(".tgz")) {
		return Option.some("tar.gz")
	}
	if (archiveUrl.endsWith(".tar.bz2") || archiveUrl.endsWith(".tbz2")) {
		return Option.some("tar.bz2")
	}
	if (archiveUrl.endsWith(".zip")) {
		return Option.some("zip")
	}
	return Option.none()
}

export const makeAgentInstaller = Effect.fn("AgentInstaller.make")(function*(
	options: AgentInstallerLiveOptions
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const crypto = yield* Crypto.Crypto
	const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

	const agentDirFor = (agentId: ProviderId): string => path.join(options.cacheDir, agentId)
	const metaPathFor = (agentId: ProviderId): string => path.join(agentDirFor(agentId), "meta.json")

	const fetchRegistry = Effect.fn("AgentInstaller.fetchRegistry")(function*() {
		const response = yield* http.get(options.registryUrl)
		return yield* HttpClientResponse.schemaBodyJson(Registry)(response)
	})

	const resolveDistribution = Effect.fn("AgentInstaller.resolveDistribution")(function*(
		agentId: ProviderId
	) {
		const registry = yield* fetchRegistry()
		const found = findAgentJson(registry.agents, options.localOverrides, agentId)
		if (Option.isNone(found)) {
			return yield* new AgentNotFoundError({ agentId })
		}
		const target = binaryTargetForPlatform(found.value.agent, options.platform)
		if (Option.isNone(target)) {
			return yield* new NoBinaryDistributionError({
				agentId,
				platform: options.platform
			})
		}
		if (target.value.sha256 === undefined) {
			return yield* new ChecksumMissingError({
				agentId,
				archiveUrl: target.value.archive
			})
		}
		const args = target.value.args === undefined ? Arr.empty<string>() : target.value.args
		return {
			agentId,
			version: found.value.agent.version,
			platform: options.platform,
			archiveUrl: target.value.archive,
			sha256: target.value.sha256,
			cmd: target.value.cmd,
			args,
			source: found.value.source
		}
	})

	const getCached = Effect.fn("AgentInstaller.getCached")(function*(agentId: ProviderId) {
		const file = metaPathFor(agentId)
		const exists = yield* fs.exists(file)
		if (exists === false) {
			return Option.none()
		}
		const text = yield* fs.readFileString(file)
		const meta = yield* decodeMetaJson(text)
		const binaryPath = path.join(agentDirFor(agentId), relativeCmd(meta.cmd))
		const binaryExists = yield* fs.exists(binaryPath)
		if (binaryExists === false) {
			return Option.none()
		}
		return Option.some({
			agentId,
			version: meta.version,
			binaryPath,
			args: meta.args
		})
	})

	const downloadBytes = Effect.fn("AgentInstaller.downloadBytes")(function*(url: string) {
		if (isAllowedDownloadUrl(url) === false) {
			return yield* new DownloadUrlNotAllowedError({ url })
		}
		const response = yield* http.get(url)
		const buffer = yield* response.arrayBuffer
		if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
			return yield* new DownloadTooLargeError({
				url,
				byteLength: buffer.byteLength
			})
		}
		return new Uint8Array(buffer)
	})

	const verifyChecksum = Effect.fn("AgentInstaller.verifyChecksum")(function*(input: {
		readonly agentId: ProviderId
		readonly expected: string
		readonly bytes: Uint8Array
	}) {
		const digest = yield* crypto.digest("SHA-256", input.bytes)
		const actual = Encoding.encodeHex(digest)
		if (checksumEquals(input.expected, actual) === false) {
			return yield* new ChecksumMismatchError({
				agentId: input.agentId,
				expected: input.expected.toLowerCase(),
				actual: actual.toLowerCase()
			})
		}
		return actual.toLowerCase()
	})

	const extractArchive = Effect.fn("AgentInstaller.extractArchive")(function*(input: {
		readonly agentId: ProviderId
		readonly archiveUrl: string
		readonly bytes: Uint8Array
		readonly destination: string
	}) {
		const kind = packedArchiveKind(input.archiveUrl)
		if (Option.isNone(kind)) {
			return yield* new UnsupportedArchiveError({ archiveUrl: input.archiveUrl })
		}
		const downloadPath = path.join(options.cacheDir, `${input.agentId}.download`)
		yield* fs.writeFile(downloadPath, input.bytes)
		const args =
			kind.value === "zip"
				? (["-o", downloadPath, "-d", input.destination] as const)
				: kind.value === "tar.bz2"
					? (["-xjf", downloadPath, "-C", input.destination] as const)
					: (["-xzf", downloadPath, "-C", input.destination] as const)
		const command = kind.value === "zip" ? "unzip" : "tar"
		yield* spawner.string(ChildProcess.make(command, Arr.fromIterable(args)))
		yield* fs.remove(downloadPath, { force: true })
	})

	const writeRawBinary = Effect.fn("AgentInstaller.writeRawBinary")(function*(input: {
		readonly destination: string
		readonly cmd: string
		readonly bytes: Uint8Array
	}) {
		const binaryPath = path.join(input.destination, relativeCmd(input.cmd))
		const parent = path.dirname(binaryPath)
		yield* fs.makeDirectory(parent, { recursive: true })
		yield* fs.writeFile(binaryPath, input.bytes)
		return binaryPath
	})

	const placePayload = Effect.fn("AgentInstaller.placePayload")(function*(input: {
		readonly agentId: ProviderId
		readonly archiveUrl: string
		readonly cmd: string
		readonly bytes: Uint8Array
		readonly destination: string
	}) {
		if (Option.isSome(packedArchiveKind(input.archiveUrl))) {
			yield* extractArchive({
				agentId: input.agentId,
				archiveUrl: input.archiveUrl,
				bytes: input.bytes,
				destination: input.destination
			})
			return path.join(input.destination, relativeCmd(input.cmd))
		}
		return yield* writeRawBinary({
			destination: input.destination,
			cmd: input.cmd,
			bytes: input.bytes
		})
	})

	const writeMeta = Effect.fn("AgentInstaller.writeMeta")(function*(input: {
		readonly directory: string
		readonly meta: AgentMeta
	}) {
		const json = yield* encodeAgentMetaJson(input.meta)
		yield* fs.writeFileString(path.join(input.directory, "meta.json"), json)
	})

	const swapInstall = Effect.fn("AgentInstaller.swapInstall")(function*(input: {
		readonly agentId: ProviderId
		readonly tmpDir: string
	}) {
		const finalDir = agentDirFor(input.agentId)
		const backupDir = `${finalDir}.bak`
		const finalExists = yield* fs.exists(finalDir)
		if (finalExists) {
			yield* fs.remove(backupDir, { recursive: true, force: true })
			yield* fs.rename(finalDir, backupDir)
		}
		yield* fs.rename(input.tmpDir, finalDir)
		if (finalExists) {
			yield* fs.remove(backupDir, { recursive: true, force: true })
		}
	})

	const install = Effect.fn("AgentInstaller.install")(function*(agentId: ProviderId) {
		const plan = yield* resolveDistribution(agentId)
		if (cmdEscapesInstallDir(plan.cmd)) {
			return yield* new UnsafeArchivePathError({
				agentId,
				cmd: plan.cmd
			})
		}
		const bytes = yield* downloadBytes(plan.archiveUrl)
		const sha256 = yield* verifyChecksum({
			agentId,
			expected: plan.sha256,
			bytes
		})
		yield* fs.makeDirectory(options.cacheDir, { recursive: true })
		const tmpDir = `${agentDirFor(agentId)}.tmp`
		yield* fs.remove(tmpDir, { recursive: true, force: true })
		yield* fs.makeDirectory(tmpDir, { recursive: true })
		const binaryPath = yield* placePayload({
			agentId,
			archiveUrl: plan.archiveUrl,
			cmd: plan.cmd,
			bytes,
			destination: tmpDir
		})
		const now = yield* DateTime.now
		const downloadedAt = yield* now.pipe(DateTime.formatIso, decodeIsoDateTime)
		yield* writeMeta({
			directory: tmpDir,
			meta: {
				version: plan.version,
				archive_url: plan.archiveUrl,
				sha256,
				downloaded_at: downloadedAt,
				cmd: plan.cmd,
				args: plan.args
			}
		})
		const binaryExists = yield* fs.exists(binaryPath)
		if (binaryExists) {
			yield* fs.chmod(binaryPath, 0o500)
		}
		yield* swapInstall({
			agentId,
			tmpDir
		})
		return {
			agentId,
			version: plan.version,
			binaryPath: path.join(agentDirFor(agentId), relativeCmd(plan.cmd)),
			args: plan.args
		}
	})

	const readClaudeInstalledVersion = Effect.fn("AgentInstaller.readClaudeInstalledVersion")(
		function*(binaryPath: string) {
			const stdout = yield* spawner.string(ChildProcess.make(binaryPath, ["--version"]))
			const parsed = parseClaudeVersion(stdout)
			if (Option.isNone(parsed)) {
				return yield* new ClaudeVersionParseError({
					binaryPath,
					stdout
				})
			}
			return parsed.value
		}
	)

	const ensureLatest = Effect.fn("AgentInstaller.ensureLatest")(function*(agentId: ProviderId) {
		const plan = yield* resolveDistribution(agentId)
		const cached = yield* getCached(agentId)
		if (Option.isNone(cached)) {
			const agent = yield* install(agentId)
			return {
				outcome: "installed" as const,
				agent,
				previousVersion: null
			}
		}
		const installedVersion =
			agentId === CLAUDE_CODE_ID
				? yield* readClaudeInstalledVersion(cached.value.binaryPath)
				: cached.value.version
		if (installedVersion === plan.version) {
			return {
				outcome: "already-current" as const,
				agent: cached.value,
				previousVersion: installedVersion
			}
		}
		const agent = yield* install(agentId)
		return {
			outcome: "updated" as const,
			agent,
			previousVersion: installedVersion
		}
	})

	const uninstall = Effect.fn("AgentInstaller.uninstall")(function*(agentId: ProviderId) {
		yield* fs.remove(agentDirFor(agentId), { recursive: true, force: true })
	})

	return AgentInstaller.of({
		resolveDistribution,
		install,
		ensureLatest,
		getCached,
		uninstall
	})
})

export const AgentInstallerLive = (options: AgentInstallerLiveOptions) =>
	Layer.effect(AgentInstaller, makeAgentInstaller(options))

export const defaultAgentInstallerOptions = (
	cacheDir: string,
	platform: PlatformKey
): AgentInstallerLiveOptions => ({
	cacheDir,
	platform,
	registryUrl: DEFAULT_REGISTRY_URL,
	localOverrides: defaultLocalOverrides
})
