import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
	ProviderAdapterError,
	ProviderCapabilities,
	ProviderId,
	type ProviderPresence
} from "../../Services/ProviderAdapter.ts"
import {
	homeRelativeFileExists,
	nonEmptyEnvValue,
	resolveOverridableExecutable
} from "../ExecutableProbe.ts"

export const GROK_PROVIDER_ID: ProviderId = ProviderId.make("grok-build")

export const GROK_REGISTRY_AGENT_ID = "grok-build"

export const GROK_CAPABILITIES: ProviderCapabilities = ProviderCapabilities.make({
	enabled: ["models", "modes", "commands", "plan", "toolCalls", "permissionRequests"]
})

export const GROK_MODES = ["agent"] as const
export type GrokMode = (typeof GROK_MODES)[number]

export type GrokPermissionDecision = "allow" | "deny"

export type GrokLaunchConfig = {
	readonly command: string
	readonly args: ReadonlyArray<string>
}

export const grokPresence = (installed: boolean, authenticated: boolean): ProviderPresence => ({
	providerId: GROK_PROVIDER_ID,
	installed,
	authenticated
})

export const adapterError = (
	operation: ProviderAdapterError["operation"],
	detail: string
): ProviderAdapterError =>
	new ProviderAdapterError({
		providerId: GROK_PROVIDER_ID,
		operation,
		detail
	})

// The name the official Grok installer puts on PATH, and the environment
// variable that overrides it with an absolute path. Same pair Cursor and
// Copilot resolve their own binary through. Official install is
// `curl -fsSL https://x.ai/cli/install.sh | bash`.
export const GROK_BINARY_NAME = "grok"
export const GROK_BINARY_ENV_KEY = "ACEPE_GROK_BIN"

// `agent stdio` is a subcommand pair, not flags. The ACP registry entry for
// grok-build runs the same args on `@xai-official/grok`, so an
// Acepe-installed binary and an operator-installed one are launched
// identically.
export const GROK_ACP_ARGS = ["agent", "stdio"] as const

export const grokLaunchConfig = (command: string): GrokLaunchConfig => ({
	command,
	args: Arr.fromIterable(GROK_ACP_ARGS)
})

// The credential store `grok login` writes, relative to the operator's home.
export const GROK_AUTH_RELATIVE_PATH = ".grok/auth.json"

// Grok's ACP authenticate method ids. cached_token reads ~/.grok/auth.json
// inside the CLI. xai.api_key reads XAI_API_KEY / GROK_CODE_XAI_API_KEY from
// the child environment. Acepe never copies the key into its own store.
export const GROK_AUTH_CACHED_TOKEN = "cached_token"
export const GROK_AUTH_API_KEY = "xai.api_key"
export const GROK_API_KEY_ENV_KEYS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] as const

export type GrokAuthenticateParams =
	| {
			readonly methodId: typeof GROK_AUTH_CACHED_TOKEN
	  }
	| {
			readonly methodId: typeof GROK_AUTH_API_KEY
			readonly _meta: { readonly headless: true }
	  }

export const grokAuthenticateParams = (apiKeyPresent: boolean): GrokAuthenticateParams => {
	if (apiKeyPresent) {
		return {
			methodId: GROK_AUTH_API_KEY,
			_meta: { headless: true }
		}
	}
	return { methodId: GROK_AUTH_CACHED_TOKEN }
}

export const probeGrokBinary = Effect.fn("probeGrokBinary")(function*() {
	return yield* resolveOverridableExecutable(GROK_BINARY_NAME, GROK_BINARY_ENV_KEY)
})

export const probeGrokApiKey = Effect.fn("probeGrokApiKey")(function*() {
	const xai = yield* nonEmptyEnvValue(GROK_API_KEY_ENV_KEYS[0])
	if (Option.isSome(xai)) {
		return true
	}
	const grokCode = yield* nonEmptyEnvValue(GROK_API_KEY_ENV_KEYS[1])
	return Option.isSome(grokCode)
})

export const probeGrokAuthenticated = Effect.fn("probeGrokAuthenticated")(function*() {
	const apiKey = yield* probeGrokApiKey()
	if (apiKey) {
		return true
	}
	return yield* homeRelativeFileExists(GROK_AUTH_RELATIVE_PATH)
})

export const probeGrokPresence = Effect.fn("probeGrokPresence")(function*() {
	const binary = yield* probeGrokBinary()
	const authenticated = yield* probeGrokAuthenticated()
	return grokPresence(Option.isSome(binary), authenticated)
})

export const probeGrokAuthenticateParams = Effect.fn("probeGrokAuthenticateParams")(function*() {
	const apiKeyPresent = yield* probeGrokApiKey()
	return grokAuthenticateParams(apiKeyPresent)
})

// Named rather than falling back to a bare "grok" spawn: a spawn of a
// command that is not there reports an opaque ENOENT from inside the
// transport, and the operator reads a transport fault where the real answer
// is that the CLI is not installed.
export const missingGrokBinaryError = (): ProviderAdapterError =>
	adapterError(
		"startSession",
		`Grok CLI is not installed. Put '${GROK_BINARY_NAME}' on PATH or set ${GROK_BINARY_ENV_KEY}.`
	)
