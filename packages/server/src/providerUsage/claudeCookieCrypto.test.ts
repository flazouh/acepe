import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { decryptChromiumCookieValue, deriveChromiumCookieKey } from "./claudeCookieCrypto.ts"

// Fixture bytes are synthesized here from a throwaway test-only password --
// never a real Keychain secret. The v10 Chromium cookie format is: the
// 3-byte ASCII prefix "v10", then AES-128-CBC(plaintext, key, iv=16 spaces)
// with PKCS7 padding, where the key is
// PBKDF2-HMAC-SHA1(password, "saltysalt", 1003 iterations, 128 bits) and the
// first 32 bytes of the plaintext are an opaque prefix the real Chromium
// format also carries (decryptChromiumCookieValue strips it).

const TEST_PASSWORD = "test-only-keychain-password"
const V10_PREFIX = new TextEncoder().encode("v10")

const encryptFixture = (key: Uint8Array, plaintext: string): Effect.Effect<Uint8Array> =>
	Effect.gen(function*() {
		const iv = new Uint8Array(16).fill(0x20)
		const cryptoKey = yield* Effect.promise(() =>
			crypto.subtle.importKey("raw", new Uint8Array(key), { name: "AES-CBC" }, false, ["encrypt"])
		)
		const encoded = new TextEncoder().encode(plaintext)
		const ciphertextBuffer = yield* Effect.promise(() =>
			crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, encoded)
		)
		const ciphertext = new Uint8Array(ciphertextBuffer)
		const out = new Uint8Array(V10_PREFIX.length + ciphertext.length)
		out.set(V10_PREFIX, 0)
		out.set(ciphertext, V10_PREFIX.length)
		return out
	})

const hashPrefixedPlaintext = (value: string): string => `${"x".repeat(32)}${value}`

Vitest.describe("deriveChromiumCookieKey", () => {
	Vitest.it.effect("derives a 16-byte AES key deterministically from a password", () =>
		Effect.gen(function*() {
			const first = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			const second = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			Vitest.assert.strictEqual(first.length, 16)
			Vitest.assert.deepStrictEqual(Array.from(first), Array.from(second))
		})
	)

	Vitest.it.effect("derives different keys for different passwords", () =>
		Effect.gen(function*() {
			const a = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			const b = yield* deriveChromiumCookieKey("a different password")
			Vitest.assert.notDeepEqual(Array.from(a), Array.from(b))
		})
	)
})

Vitest.describe("decryptChromiumCookieValue", () => {
	Vitest.it.effect("round-trips a v10-encrypted cookie value synthesized with a known key", () =>
		Effect.gen(function*() {
			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			const fixture = yield* encryptFixture(key, hashPrefixedPlaintext("session-token-value"))
			const decrypted = yield* decryptChromiumCookieValue(fixture, key)
			Vitest.assert.strictEqual(decrypted, "session-token-value")
		})
	)

	Vitest.it.effect("fails when the v10 prefix is missing", () =>
		Effect.gen(function*() {
			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			const exit = yield* Effect.exit(decryptChromiumCookieValue(new TextEncoder().encode("garbage"), key))
			Vitest.assert.strictEqual(exit._tag, "Failure")
		})
	)

	Vitest.it.effect("fails when decrypted with the wrong key", () =>
		Effect.gen(function*() {
			const key = yield* deriveChromiumCookieKey(TEST_PASSWORD)
			const wrongKey = yield* deriveChromiumCookieKey("wrong password entirely")
			const fixture = yield* encryptFixture(key, hashPrefixedPlaintext("session-token-value"))
			const exit = yield* Effect.exit(decryptChromiumCookieValue(fixture, wrongKey))
			Vitest.assert.strictEqual(exit._tag, "Failure")
		})
	)
})
