import * as Config from "effect/Config"
import * as Effect from "effect/Effect"

export type SigningPolicy = {
	readonly codesign: boolean
	readonly notarize: boolean
	readonly staple: boolean
}

export const githubSecretToElectrobunEnv = {
	APPLE_SIGNING_IDENTITY: "ELECTROBUN_DEVELOPER_ID",
	APPLE_ID: "ELECTROBUN_APPLEID",
	APPLE_PASSWORD: "ELECTROBUN_APPLEIDPASS",
	APPLE_TEAM_ID: "ELECTROBUN_TEAMID",
} as const

export const macEntitlements: Record<string, boolean> = {
	"com.apple.security.cs.allow-jit": true,
	"com.apple.security.cs.allow-unsigned-executable-memory": true,
	"com.apple.security.cs.disable-library-validation": true,
	"com.apple.security.device.audio-input": true,
	"com.apple.security.network.client": true,
	"com.apple.security.network.server": true,
	"com.apple.security.files.user-selected.read-write": true,
}

const signFlag = Config.boolean("SIGN").pipe(Config.nested("ACEPE"), Config.withDefault(false))

export const loadSigningPolicy = signFlag.pipe(
	Effect.map((sign) => ({
		codesign: sign,
		notarize: sign,
		staple: sign,
	})),
)

export const stapleCommands = (appPath: string): ReadonlyArray<ReadonlyArray<string>> => [
	["xcrun", "stapler", "staple", appPath],
	["xcrun", "stapler", "validate", appPath],
]
