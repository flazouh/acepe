import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	binaryTargetForPlatform,
	checksumEquals,
	decodeAgentJson,
	decodeRegistry,
	findAgentJson,
	platformKeyFromHost,
	relativeCmd
} from "./agentJson.ts"
import { ProviderId } from "./Services/ProviderAdapter.ts"

const gooseDarwin = {
	archive: "https://github.com/block/goose/releases/download/v1.46.0/goose-aarch64-apple-darwin.tar.bz2",
	cmd: "./goose",
	args: ["acp"],
	sha256: "de263fb06839de31345dff08aeba999ba165b023cd3cec7ec3bef20f6f4f7e73"
}

Vitest.describe("agent.json schema", () => {
	Vitest.it.effect("decodes per-platform archive, cmd, args, and sha256 from an agent.json document", () =>
		Effect.gen(function*() {
			const agent = yield* decodeAgentJson({
				id: "goose",
				name: "goose",
				version: "1.46.0",
				icon: "https://cdn.agentclientprotocol.com/registry/v1/latest/goose.svg",
				distribution: {
					binary: {
						"darwin-aarch64": gooseDarwin
					}
				}
			})
			Vitest.assert.strictEqual(agent.id, "goose")
			Vitest.assert.strictEqual(agent.version, "1.46.0")
			const target = binaryTargetForPlatform(agent, "darwin-aarch64")
			Vitest.assert.deepStrictEqual(target, Option.some(gooseDarwin))
			Vitest.assert.deepStrictEqual(binaryTargetForPlatform(agent, "linux-x86_64"), Option.none())
		})
	)

	Vitest.it.effect("decodes a registry.json document as an array of agent.json entries", () =>
		Effect.gen(function*() {
			const registry = yield* decodeRegistry({
				version: "1.0.0",
				agents: [
					{
						id: "cursor",
						version: "2026.08.11",
						distribution: {
							binary: {
								"darwin-aarch64": {
									archive:
										"https://downloads.cursor.com/lab/2026.08.11-e8db854/darwin/arm64/agent-cli-package.tar.gz",
									cmd: "./dist-package/cursor-agent",
									args: ["acp"]
								}
							}
						}
					}
				]
			})
			Vitest.assert.strictEqual(registry.agents.length, 1)
			Vitest.assert.strictEqual(registry.agents[0]?.id, "cursor")
			Vitest.assert.strictEqual(registry.agents[0]?.distribution.binary?.["darwin-aarch64"]?.cmd, "./dist-package/cursor-agent")
		})
	)
})

Vitest.describe("findAgentJson", () => {
	Vitest.it.effect("prefers the registry entry over a local override with the same id", () =>
		Effect.gen(function*() {
			const registryAgent = yield* decodeAgentJson({
				id: "cursor",
				version: "2026.08.11",
				distribution: {
					binary: {
						"darwin-aarch64": {
							archive: "https://cdn.agentclientprotocol.com/cursor.tar.gz",
							cmd: "./cursor-agent",
							sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
						}
					}
				}
			})
			const overrideAgent = yield* decodeAgentJson({
				id: "cursor",
				version: "0.0.1",
				distribution: {
					binary: {
						"darwin-aarch64": {
							archive: "https://github.com/acepe/override.tar.gz",
							cmd: "./override",
							sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
						}
					}
				}
			})
			const found = findAgentJson([registryAgent], [overrideAgent], ProviderId.make("cursor"))
			Vitest.assert.strictEqual(Option.isSome(found), true)
			if (Option.isSome(found)) {
				Vitest.assert.strictEqual(found.value.source, "registry")
				Vitest.assert.strictEqual(found.value.agent.version, "2026.08.11")
			}
		})
	)

	Vitest.it.effect("falls back to a local override when the registry has no matching id", () =>
		Effect.gen(function*() {
			const overrideAgent = yield* decodeAgentJson({
				id: "claude-code",
				version: "2.1.186",
				distribution: {
					binary: {
						"darwin-aarch64": {
							archive: "https://github.com/acepe/claude.tar.gz",
							cmd: "./claude",
							sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
						}
					}
				}
			})
			const found = findAgentJson([], [overrideAgent], ProviderId.make("claude-code"))
			Vitest.assert.strictEqual(Option.isSome(found), true)
			if (Option.isSome(found)) {
				Vitest.assert.strictEqual(found.value.source, "local-override")
				Vitest.assert.strictEqual(found.value.agent.id, "claude-code")
			}
		})
	)
})

Vitest.describe("platform and checksum helpers", () => {
	Vitest.it("maps host os and arch to an ACP platform key", () => {
		Vitest.assert.deepStrictEqual(platformKeyFromHost("darwin", "arm64"), Option.some("darwin-aarch64"))
		Vitest.assert.deepStrictEqual(platformKeyFromHost("linux", "x64"), Option.some("linux-x86_64"))
		Vitest.assert.deepStrictEqual(platformKeyFromHost("sunos", "x64"), Option.none())
	})

	Vitest.it("strips the ./ prefix from registry cmd values", () => {
		Vitest.assert.strictEqual(relativeCmd("./dist-package/cursor-agent"), "dist-package/cursor-agent")
		Vitest.assert.strictEqual(relativeCmd("copilot.exe"), "copilot.exe")
	})

	Vitest.it("compares checksums without case sensitivity", () => {
		Vitest.assert.strictEqual(
			checksumEquals(
				"2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824",
				"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
			),
			true
		)
		Vitest.assert.strictEqual(
			checksumEquals(
				"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
			),
			false
		)
	})
})
