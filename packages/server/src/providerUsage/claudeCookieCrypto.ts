import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

// Ported from provider_account_usage/mod.rs's Chromium "v10" cookie
// decryption: PBKDF2-HMAC-SHA1(password, "saltysalt", 1003 iterations) -> a
// 128-bit AES key, then AES-128-CBC decrypt with a 16-byte space IV. Uses the
// Web Crypto API (globalThis.crypto.subtle, available in Bun) instead of a
// node:crypto import -- this repo's Effect lint bans node: builtins.
//
// The token/key bytes themselves never leave this module or get logged; only
// the decrypted cookie string is returned to the caller, which itself never
// crosses the RPC boundary (see Layers/ProviderUsageService.ts).

const CHROMIUM_COOKIE_SALT = "saltysalt"
const CHROMIUM_COOKIE_PBKDF2_ITERATIONS = 1003
const CHROMIUM_COOKIE_KEY_BITS = 128
const CHROMIUM_COOKIE_V10_PREFIX = "v10"
const CHROMIUM_COOKIE_IV_BYTE = 0x20 // ASCII space, 16 of them, per Chromium's fixed IV.
const CHROMIUM_COOKIE_HASH_PREFIX_BYTES = 32

export class ClaudeCookieCryptoError extends Schema.TaggedError<ClaudeCookieCryptoError>()(
	"ClaudeCookieCryptoError",
	{
		reason: Schema.String,
	},
) {
	override get message(): string {
		return this.reason
	}
}

const textEncoder = new TextEncoder()

export const deriveChromiumCookieKey = Effect.fn("providerUsage.deriveChromiumCookieKey")(
	function*(password: string) {
		const keyMaterial = yield* Effect.tryPromise({
			try: () =>
				crypto.subtle.importKey("raw", textEncoder.encode(password), { name: "PBKDF2" }, false, [
					"deriveBits",
				]),
			catch: () => new ClaudeCookieCryptoError({ reason: "Could not import the Claude cookie password" }),
		})
		const bits = yield* Effect.tryPromise({
			try: () =>
				crypto.subtle.deriveBits(
					{
						name: "PBKDF2",
						salt: textEncoder.encode(CHROMIUM_COOKIE_SALT),
						iterations: CHROMIUM_COOKIE_PBKDF2_ITERATIONS,
						hash: "SHA-1",
					},
					keyMaterial,
					CHROMIUM_COOKIE_KEY_BITS,
				),
			catch: () => new ClaudeCookieCryptoError({ reason: "Could not derive the Claude cookie key" }),
		})
		return new Uint8Array(bits)
	},
)

export const decryptChromiumCookieValue = Effect.fn("providerUsage.decryptChromiumCookieValue")(
	function*(encrypted: Uint8Array, key: Uint8Array) {
		const prefix = new TextDecoder("ascii").decode(encrypted.slice(0, 3))
		if (encrypted.length < 3 || prefix !== CHROMIUM_COOKIE_V10_PREFIX) {
			return yield* new ClaudeCookieCryptoError({ reason: "Unsupported Claude desktop cookie encryption" })
		}

		// Re-copy into a fresh Uint8Array so its backing buffer is a concrete
		// ArrayBuffer -- callers may hand us a view over a SharedArrayBuffer-
		// compatible ArrayBufferLike (e.g. a sqlite driver's BLOB column), which
		// the DOM lib's BufferSource types reject.
		const ciphertext = new Uint8Array(encrypted.slice(3))
		const keyBytes = new Uint8Array(key)
		const iv = new Uint8Array(16).fill(CHROMIUM_COOKIE_IV_BYTE)
		const cryptoKey = yield* Effect.tryPromise({
			try: () => crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]),
			catch: () => new ClaudeCookieCryptoError({ reason: "Could not import the Claude cookie key" }),
		})
		const decrypted = yield* Effect.tryPromise({
			try: () => crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, ciphertext),
			catch: () => new ClaudeCookieCryptoError({ reason: "Could not decrypt Claude desktop cookie" }),
		})
		const plaintext = new Uint8Array(decrypted)

		if (plaintext.length <= CHROMIUM_COOKIE_HASH_PREFIX_BYTES) {
			return yield* new ClaudeCookieCryptoError({ reason: "Claude desktop cookie plaintext was too short" })
		}

		return yield* Effect.try({
			try: () =>
				new TextDecoder("utf-8", { fatal: true }).decode(
					plaintext.slice(CHROMIUM_COOKIE_HASH_PREFIX_BYTES),
				),
			catch: () => new ClaudeCookieCryptoError({ reason: "Claude desktop cookie plaintext was not valid UTF-8" }),
		})
	},
)
