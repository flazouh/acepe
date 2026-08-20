import { expect, test } from "bun:test"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"

import {
	githubSecretToElectrobunEnv,
	loadSigningPolicy,
	macEntitlements,
	stapleCommands,
} from "./signing.ts"

test("signing credentials turn codesign, notarize, and staple on", () => {
	const provider = ConfigProvider.fromEnv({ env: { ACEPE_SIGN: "true" } })
	const policy = Effect.runSync(
		loadSigningPolicy.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(policy.codesign).toBe(true)
	expect(policy.notarize).toBe(true)
	expect(policy.staple).toBe(true)
})

test("missing credentials leave the local build unsigned", () => {
	const provider = ConfigProvider.fromUnknown({})
	const policy = Effect.runSync(
		loadSigningPolicy.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(policy.codesign).toBe(false)
	expect(policy.notarize).toBe(false)
	expect(policy.staple).toBe(false)
})

test("staple commands attach and check the notarisation ticket", () => {
	const commands = stapleCommands("/tmp/Acepe.app")
	expect(commands).toEqual([
		["xcrun", "stapler", "staple", "/tmp/Acepe.app"],
		["xcrun", "stapler", "validate", "/tmp/Acepe.app"],
	])
})

test("github apple secrets map onto electrobun env names", () => {
	expect(githubSecretToElectrobunEnv.APPLE_SIGNING_IDENTITY).toBe("ELECTROBUN_DEVELOPER_ID")
	expect(githubSecretToElectrobunEnv.APPLE_ID).toBe("ELECTROBUN_APPLEID")
	expect(githubSecretToElectrobunEnv.APPLE_PASSWORD).toBe("ELECTROBUN_APPLEIDPASS")
	expect(githubSecretToElectrobunEnv.APPLE_TEAM_ID).toBe("ELECTROBUN_TEAMID")
})

test("mac entitlements include bun jit hardened-runtime keys", () => {
	expect(macEntitlements["com.apple.security.cs.allow-jit"]).toBe(true)
	expect(macEntitlements["com.apple.security.cs.allow-unsigned-executable-memory"]).toBe(true)
	expect(macEntitlements["com.apple.security.cs.disable-library-validation"]).toBe(true)
})
