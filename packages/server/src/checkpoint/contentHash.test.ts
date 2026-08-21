import * as BunCrypto from "@effect/platform-bun/BunCrypto"
import * as Vitest from "@effect/vitest"
import * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import { sha256Hex } from "./contentHash.ts"

const HELLO_WORLD_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"

Vitest.layer(BunCrypto.layer)("sha256Hex", (it) => {
	it.effect("matches CheckpointManager::compute_hash for hello world", () =>
		Effect.gen(function*() {
			const crypto = yield* Crypto.Crypto
			const hash = yield* sha256Hex(crypto, "hello world")
			Vitest.assert.strictEqual(hash, HELLO_WORLD_SHA256)
			Vitest.assert.strictEqual(hash.length, 64)
		})
	)

	it.effect("is stable for the same content and changes when the content changes", () =>
		Effect.gen(function*() {
			const crypto = yield* Crypto.Crypto
			const first = yield* sha256Hex(crypto, "hello world")
			const second = yield* sha256Hex(crypto, "hello world")
			const third = yield* sha256Hex(crypto, "hello world!")
			Vitest.assert.strictEqual(first, second)
			Vitest.assert.notStrictEqual(first, third)
		})
	)
})
