import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ProviderId } from "./ProviderAdapter.ts"
import {
	AgentInstaller,
	AgentNotFoundError,
	ChecksumMissingError,
	ChecksumMismatchError
} from "./AgentInstaller.ts"

Vitest.describe("AgentInstaller", () => {
	Vitest.it("is a service class", () => {
		Vitest.assert.strictEqual(AgentInstaller.key, "@acepe/server/provider/Services/AgentInstaller")
	})
})

Vitest.describe("AgentInstaller errors", () => {
	Vitest.it.effect("AgentNotFoundError is a tagged yieldable error", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new AgentNotFoundError({
					agentId: ProviderId.make("forge")
				})
			)
			Vitest.assert.strictEqual(error._tag, "AgentNotFoundError")
			Vitest.assert.isTrue(Schema.is(AgentNotFoundError)(error))
		})
	)

	Vitest.it.effect("ChecksumMissingError refuses an archive with no sha256", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ChecksumMissingError({
					agentId: ProviderId.make("cursor"),
					archiveUrl: "https://downloads.cursor.com/agent.tar.gz"
				})
			)
			Vitest.assert.strictEqual(error._tag, "ChecksumMissingError")
			Vitest.assert.strictEqual(
				error.message,
				"Agent 'cursor' archive 'https://downloads.cursor.com/agent.tar.gz' has no sha256; refusing to download."
			)
		})
	)

	Vitest.it.effect("ChecksumMismatchError names the expected and actual hashes", () =>
		Effect.gen(function*() {
			const error = yield* Effect.flip(
				new ChecksumMismatchError({
					agentId: ProviderId.make("opencode"),
					expected: "aa",
					actual: "bb"
				})
			)
			Vitest.assert.strictEqual(error._tag, "ChecksumMismatchError")
			Vitest.assert.strictEqual(
				error.message,
				"Agent 'opencode' archive checksum mismatch: expected aa, got bb."
			)
		})
	)
})
