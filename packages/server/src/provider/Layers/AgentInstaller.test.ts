import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner"
import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Rec from "effect/Record"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
	AgentJson,
	DEFAULT_REGISTRY_URL,
	encodeRegistryJson,
	Registry
} from "../agentJson.ts"
import { AgentInstaller } from "../Services/AgentInstaller.ts"
import { ProviderId } from "../Services/ProviderAdapter.ts"
import { AgentInstallerLive } from "./AgentInstaller.ts"

const HELLO_TEXT = "hello"
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
const HELLO_URL = "https://github.com/acepe-test/agents/releases/download/v1/hello.bin"
const CLAUDE_URL = "https://github.com/acepe-test/agents/releases/download/v1/claude.bin"
const WRONG_SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const OPENCODE_ID = ProviderId.make("opencode")
const CLAUDE_ID = ProviderId.make("claude-code")
const helloBytes = new TextEncoder().encode(HELLO_TEXT)
const claudeScript = new TextEncoder().encode('#!/bin/sh\necho "2.1.186 (Claude Code)"\n')

const PlatformLive = Layer.mergeAll(
	BunCrypto.layer,
	BunChildProcessSpawner.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))
	)
)

const makeFakeHttpClient = (bodies: Readonly<Record<string, Uint8Array>>): HttpClient.HttpClient =>
	HttpClient.make((request, url) => {
		const body = Rec.get(bodies, url.href)
		if (Option.isNone(body)) {
			return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 })))
		}
		const copy = new Uint8Array(body.value.byteLength)
		copy.set(body.value)
		return Effect.succeed(
			HttpClientResponse.fromWeb(request, new Response(copy.buffer, { status: 200 }))
		)
	})

const binaryAgent = (input: {
	readonly id: string
	readonly version: string
	readonly archive: string
	readonly cmd: string
	readonly sha256: string
	readonly args?: ReadonlyArray<string>
}): AgentJson =>
	AgentJson.make({
		id: input.id,
		version: input.version,
		distribution: {
			binary: {
				"darwin-aarch64":
					input.args === undefined
						? {
								archive: input.archive,
								cmd: input.cmd,
								sha256: input.sha256
							}
						: {
								archive: input.archive,
								cmd: input.cmd,
								args: input.args,
								sha256: input.sha256
							}
			}
		}
	})

const installerLayer = (input: {
	readonly cacheDir: string
	readonly registryJson: string
	readonly archives: Readonly<Record<string, Uint8Array>>
	readonly localOverrides: ReadonlyArray<AgentJson>
}) => {
	const bodies: Record<string, Uint8Array> = {
		[DEFAULT_REGISTRY_URL]: new TextEncoder().encode(input.registryJson)
	}
	for (const url of Rec.keys(input.archives)) {
		const bytes = input.archives[url]
		if (bytes !== undefined) {
			bodies[url] = bytes
		}
	}
	return AgentInstallerLive({
		cacheDir: input.cacheDir,
		platform: "darwin-aarch64",
		registryUrl: DEFAULT_REGISTRY_URL,
		localOverrides: input.localOverrides
	}).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, makeFakeHttpClient(bodies))))
}

const runWithInstaller = <A, E>(
	cacheDir: string,
	registryJson: string,
	archives: Readonly<Record<string, Uint8Array>>,
	localOverrides: ReadonlyArray<AgentJson>,
	program: Effect.Effect<A, E, AgentInstaller>
) =>
	program.pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off
		Effect.provide(installerLayer({ cacheDir, registryJson, archives, localOverrides }))
	)

Vitest.layer(PlatformLive)("AgentInstallerLive", (it) => {
	it.effect("reads per-platform archive, cmd, and args from registry agent.json data", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const agent = binaryAgent({
				id: "opencode",
				version: "1.18.20",
				archive: HELLO_URL,
				cmd: "./opencode",
				sha256: HELLO_SHA256,
				args: ["acp"]
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [agent]
				})
			)
			const plan = yield* runWithInstaller(
				cacheDir,
				registryJson,
				{ [HELLO_URL]: helloBytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.resolveDistribution(OPENCODE_ID)
				})
			)
			Vitest.assert.strictEqual(plan.archiveUrl, HELLO_URL)
			Vitest.assert.strictEqual(plan.cmd, "./opencode")
			Vitest.assert.deepStrictEqual(plan.args, ["acp"])
			Vitest.assert.strictEqual(plan.source, "registry")
			Vitest.assert.strictEqual(plan.sha256, HELLO_SHA256)
		})
	)

	it.effect("verifies the checksum and refuses to extract on mismatch", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const agent = binaryAgent({
				id: "opencode",
				version: "1.18.20",
				archive: HELLO_URL,
				cmd: "./opencode",
				sha256: WRONG_SHA256
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [agent]
				})
			)
			const error = yield* Effect.flip(
				runWithInstaller(
					cacheDir,
					registryJson,
					{ [HELLO_URL]: helloBytes },
					[],
					Effect.gen(function*() {
						const installer = yield* AgentInstaller
						return yield* installer.install(OPENCODE_ID)
					})
				)
			)
			Vitest.assert.strictEqual(error._tag, "ChecksumMismatchError")
			const cached = yield* runWithInstaller(
				cacheDir,
				registryJson,
				{ [HELLO_URL]: helloBytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.getCached(OPENCODE_ID)
				})
			)
			Vitest.assert.strictEqual(Option.isNone(cached), true)
		})
	)

	it.effect("refuses a binary target that has no sha256", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const agent = AgentJson.make({
				id: "cursor",
				version: "2026.08.11",
				distribution: {
					binary: {
						"darwin-aarch64": {
							archive: "https://downloads.cursor.com/lab/agent.tar.gz",
							cmd: "./dist-package/cursor-agent",
							args: ["acp"]
						}
					}
				}
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [agent]
				})
			)
			const error = yield* Effect.flip(
				runWithInstaller(
					cacheDir,
					registryJson,
					{},
					[],
					Effect.gen(function*() {
						const installer = yield* AgentInstaller
						return yield* installer.install(ProviderId.make("cursor"))
					})
				)
			)
			Vitest.assert.strictEqual(error._tag, "ChecksumMissingError")
		})
	)

	it.effect("installs a checksum-verified raw binary from registry data", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const agent = binaryAgent({
				id: "opencode",
				version: "1.18.20",
				archive: HELLO_URL,
				cmd: "./opencode",
				sha256: HELLO_SHA256,
				args: ["acp"]
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [agent]
				})
			)
			const installed = yield* runWithInstaller(
				cacheDir,
				registryJson,
				{ [HELLO_URL]: helloBytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.install(OPENCODE_ID)
				})
			)
			Vitest.assert.strictEqual(installed.version, "1.18.20")
			Vitest.assert.deepStrictEqual(installed.args, ["acp"])
			const contents = yield* fs.readFileString(installed.binaryPath)
			Vitest.assert.strictEqual(contents, HELLO_TEXT)
		})
	)

	it.effect("auto-updates a managed CLI when the latest registry version changes", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const v1 = binaryAgent({
				id: "opencode",
				version: "1.0.0",
				archive: HELLO_URL,
				cmd: "./opencode",
				sha256: HELLO_SHA256
			})
			const v1Json = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [v1]
				})
			)
			const first = yield* runWithInstaller(
				cacheDir,
				v1Json,
				{ [HELLO_URL]: helloBytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.ensureLatest(OPENCODE_ID)
				})
			)
			Vitest.assert.strictEqual(first.outcome, "installed")
			const v2Bytes = new TextEncoder().encode("hello-v2")
			const crypto = yield* Crypto.Crypto
			const v2Digest = yield* crypto.digest("SHA-256", v2Bytes)
			const v2Sha = Encoding.encodeHex(v2Digest)
			const v2Url = "https://github.com/acepe-test/agents/releases/download/v2/hello.bin"
			const v2 = binaryAgent({
				id: "opencode",
				version: "2.0.0",
				archive: v2Url,
				cmd: "./opencode",
				sha256: v2Sha
			})
			const v2Json = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [v2]
				})
			)
			const second = yield* runWithInstaller(
				cacheDir,
				v2Json,
				{ [v2Url]: v2Bytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.ensureLatest(OPENCODE_ID)
				})
			)
			Vitest.assert.strictEqual(second.outcome, "updated")
			Vitest.assert.strictEqual(second.previousVersion, "1.0.0")
			Vitest.assert.strictEqual(second.agent.version, "2.0.0")
			const contents = yield* fs.readFileString(second.agent.binaryPath)
			Vitest.assert.strictEqual(contents, "hello-v2")
		})
	)

	it.effect("uses a local override entry when the agent is not in the registry", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const override = binaryAgent({
				id: "claude-code",
				version: "2.1.186",
				archive: CLAUDE_URL,
				cmd: "./claude",
				sha256: HELLO_SHA256
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: []
				})
			)
			const plan = yield* runWithInstaller(
				cacheDir,
				registryJson,
				{ [CLAUDE_URL]: helloBytes },
				[override],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.resolveDistribution(CLAUDE_ID)
				})
			)
			Vitest.assert.strictEqual(plan.source, "local-override")
			Vitest.assert.strictEqual(plan.cmd, "./claude")
		})
	)

	it.effect("treats claude --version suffix output as current when the catalog version matches", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const crypto = yield* Crypto.Crypto
			const digest = yield* crypto.digest("SHA-256", claudeScript)
			const sha256 = Encoding.encodeHex(digest)
			const override = binaryAgent({
				id: "claude-code",
				version: "2.1.186",
				archive: CLAUDE_URL,
				cmd: "./claude",
				sha256
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: []
				})
			)
			const archives = { [CLAUDE_URL]: claudeScript }
			const first = yield* runWithInstaller(
				cacheDir,
				registryJson,
				archives,
				[override],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.ensureLatest(CLAUDE_ID)
				})
			)
			Vitest.assert.strictEqual(first.outcome, "installed")
			const second = yield* runWithInstaller(
				cacheDir,
				registryJson,
				archives,
				[override],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.ensureLatest(CLAUDE_ID)
				})
			)
			Vitest.assert.strictEqual(second.outcome, "already-current")
			Vitest.assert.strictEqual(second.previousVersion, "2.1.186")
		})
	)

	it.effect("extracts a checksum-verified tar.gz after the hash matches", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const crypto = yield* Crypto.Crypto
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const cacheDir = yield* fs.makeTempDirectoryScoped()
			const staging = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(path.join(staging, "opencode"), HELLO_TEXT)
			const archivePath = path.join(staging, "opencode.tar.gz")
			yield* spawner.string(
				ChildProcess.make("tar", ["-czf", archivePath, "-C", staging, "opencode"])
			)
			const archiveBytes = yield* fs.readFile(archivePath)
			const digest = yield* crypto.digest("SHA-256", archiveBytes)
			const sha256 = Encoding.encodeHex(digest)
			const archiveUrl = "https://github.com/acepe-test/agents/releases/download/v1/opencode.tar.gz"
			const agent = binaryAgent({
				id: "opencode",
				version: "1.18.20",
				archive: archiveUrl,
				cmd: "./opencode",
				sha256
			})
			const registryJson = yield* encodeRegistryJson(
				Registry.make({
					version: "1.0.0",
					agents: [agent]
				})
			)
			const installed = yield* runWithInstaller(
				cacheDir,
				registryJson,
				{ [archiveUrl]: archiveBytes },
				[],
				Effect.gen(function*() {
					const installer = yield* AgentInstaller
					return yield* installer.install(OPENCODE_ID)
				})
			)
			const contents = yield* fs.readFileString(installed.binaryPath)
			Vitest.assert.strictEqual(contents, HELLO_TEXT)
		})
	)
})
