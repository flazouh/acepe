import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export type SigningPolicy = {
	readonly codesign: boolean
	readonly notarize: boolean
	readonly staple: boolean
}

export type NotarizeCredentialInput = {
	readonly appleId: Option.Option<string>
	readonly applePassword: Option.Option<string>
	readonly teamId: Option.Option<string>
	readonly apiIssuer: Option.Option<string>
	readonly apiKey: Option.Option<string>
	readonly apiKeyPath: Option.Option<string>
}

export const githubSecretToElectrobunEnv = {
	APPLE_SIGNING_IDENTITY: "ELECTROBUN_DEVELOPER_ID",
	APPLE_ID: "ELECTROBUN_APPLEID",
	APPLE_PASSWORD: "ELECTROBUN_APPLEIDPASS",
	APPLE_TEAM_ID: "ELECTROBUN_TEAMID",
} as const

export const macEntitlements: Record<string, boolean | string> = {
	"com.apple.security.cs.allow-jit": true,
	"com.apple.security.cs.allow-unsigned-executable-memory": true,
	"com.apple.security.cs.disable-library-validation": true,
	"com.apple.security.device.audio-input": "Acepe records microphone input for voice features.",
	"com.apple.security.network.client": true,
	"com.apple.security.network.server": true,
	"com.apple.security.files.user-selected.read-write": "Acepe reads and writes the files you select.",
}

const signFlag = Config.boolean("SIGN").pipe(Config.nested("ACEPE"), Config.withDefault(false))

const nestedOption = (name: string, parent: string) =>
	Config.option(Config.string(name).pipe(Config.nested(parent))).pipe(
		Effect.orElseSucceed(() => Option.none<string>()),
	)

const isPresent = (value: Option.Option<string>): boolean =>
	Option.isSome(value) === true && value.value.length > 0

const firstPresent = (
	primary: Option.Option<string>,
	fallback: Option.Option<string>,
): Option.Option<string> => {
	if (isPresent(primary) === true) {
		return primary
	}
	if (isPresent(fallback) === true) {
		return fallback
	}
	return Option.none()
}

export const hasNotarizeCredentials = (input: NotarizeCredentialInput): boolean => {
	const appleIdComplete =
		isPresent(input.appleId) && isPresent(input.applePassword) && isPresent(input.teamId)
	const apiKeyComplete =
		isPresent(input.apiIssuer) && isPresent(input.apiKey) && isPresent(input.apiKeyPath)
	return appleIdComplete || apiKeyComplete
}

export const loadSigningPolicy = Effect.gen(function* () {
	const sign = yield* signFlag
	const credentials: NotarizeCredentialInput = {
		appleId: firstPresent(
			yield* nestedOption("APPLEID", "ELECTROBUN"),
			yield* nestedOption("ID", "APPLE"),
		),
		applePassword: firstPresent(
			yield* nestedOption("APPLEIDPASS", "ELECTROBUN"),
			yield* nestedOption("PASSWORD", "APPLE"),
		),
		teamId: firstPresent(
			yield* nestedOption("TEAMID", "ELECTROBUN"),
			yield* nestedOption("TEAM_ID", "APPLE"),
		),
		apiIssuer: yield* nestedOption("APPLEAPIISSUER", "ELECTROBUN"),
		apiKey: yield* nestedOption("APPLEAPIKEY", "ELECTROBUN"),
		apiKeyPath: yield* nestedOption("APPLEAPIKEYPATH", "ELECTROBUN"),
	}
	const notarize = sign === true && hasNotarizeCredentials(credentials)
	return {
		codesign: sign,
		notarize,
		staple: notarize,
	}
})

export const stapleCommands = (appPath: string): ReadonlyArray<ReadonlyArray<string>> => [
	["xcrun", "stapler", "staple", appPath],
	["xcrun", "stapler", "validate", appPath],
]
