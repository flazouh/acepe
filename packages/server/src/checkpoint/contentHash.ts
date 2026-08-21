import type * as Crypto from "effect/Crypto"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Str from "effect/String"

export const utf8Bytes = (content: string): Uint8Array => new TextEncoder().encode(content)

export const sha256Hex = Effect.fn("sha256Hex")(function*(
	crypto: Crypto.Crypto,
	content: string
) {
	const digest = yield* crypto.digest("SHA-256", utf8Bytes(content))
	return Str.toLowerCase(Encoding.encodeHex(digest))
})
