import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Option from "effect/Option"

// Seam over the macOS `security` CLI (Keychain access). A thin interface so
// tests can substitute a fake instead of exercising the real Keychain --
// which would either need a real login keychain entry or trip a TCC
// permission prompt, neither of which belongs in a test run.
//
// The Live implementation (Layers/SecurityKeychain.ts) always succeeds with
// Option.none() rather than failing: "not found", "denied", and "timed out
// waiting on a Keychain prompt" are all just "this provider is
// unavailable" from the caller's point of view, matching the Rust side's
// behavior of returning an unavailable_provider() rather than propagating a
// Keychain error.
export interface SecurityKeychainShape {
	readonly findGenericPassword: (input: {
		readonly service: string
		readonly account?: string
	}) => Effect.Effect<Option.Option<string>>
}

export class SecurityKeychain extends Context.Service<SecurityKeychain, SecurityKeychainShape>()(
	"@acepe/server/providerUsage/Services/SecurityKeychain",
) {}
