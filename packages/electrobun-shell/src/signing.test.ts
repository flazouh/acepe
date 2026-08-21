import { expect, test } from "bun:test"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

import {
	githubSecretToElectrobunEnv,
	hasNotarizeCredentials,
	loadSigningPolicy,
	macEntitlements,
	stapleCommands,
} from "./signing.ts"

test("ACEPE_SIGN without Apple credentials codesigns and skips notarisation", () => {
	const provider = ConfigProvider.fromEnv({ env: { ACEPE_SIGN: "true" } })
	const policy = Effect.runSync(
		loadSigningPolicy.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(policy.codesign).toBe(true)
	expect(policy.notarize).toBe(false)
	expect(policy.staple).toBe(false)
})

test("ACEPE_SIGN with Apple ID credentials codesigns, notarises, and staples", () => {
	const provider = ConfigProvider.fromEnv({
		env: {
			ACEPE_SIGN: "true",
			ELECTROBUN_APPLEID: "dev@acepe.app",
			ELECTROBUN_APPLEIDPASS: "app-specific-password",
			ELECTROBUN_TEAMID: "GD7PWQBWJV",
		},
	})
	const policy = Effect.runSync(
		loadSigningPolicy.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(policy.codesign).toBe(true)
	expect(policy.notarize).toBe(true)
	expect(policy.staple).toBe(true)
})

test("ACEPE_SIGN with GitHub Apple secrets codesigns, notarises, and staples", () => {
	const provider = ConfigProvider.fromEnv({
		env: {
			ACEPE_SIGN: "true",
			APPLE_ID: "dev@acepe.app",
			APPLE_PASSWORD: "app-specific-password",
			APPLE_TEAM_ID: "GD7PWQBWJV",
		},
	})
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

test("notarize credentials need the full Apple ID trio or the API key trio", () => {
	expect(
		hasNotarizeCredentials({
			appleId: Option.some("dev@acepe.app"),
			applePassword: Option.some("app-specific-password"),
			teamId: Option.some("GD7PWQBWJV"),
			apiIssuer: Option.none(),
			apiKey: Option.none(),
			apiKeyPath: Option.none(),
		}),
	).toBe(true)
	expect(
		hasNotarizeCredentials({
			appleId: Option.some("dev@acepe.app"),
			applePassword: Option.none(),
			teamId: Option.some("GD7PWQBWJV"),
			apiIssuer: Option.none(),
			apiKey: Option.none(),
			apiKeyPath: Option.none(),
		}),
	).toBe(false)
	expect(
		hasNotarizeCredentials({
			appleId: Option.none(),
			applePassword: Option.none(),
			teamId: Option.none(),
			apiIssuer: Option.some("issuer"),
			apiKey: Option.some("key-id"),
			apiKeyPath: Option.some("/tmp/AuthKey.p8"),
		}),
	).toBe(true)
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
