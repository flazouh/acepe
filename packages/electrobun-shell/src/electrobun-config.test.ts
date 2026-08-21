import { expect, test } from "bun:test"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"

import { makeElectrobunConfig, loadElectrobunConfig, electrobunReleaseChannel, electrobunCliBuildArgs } from "./electrobun-config.ts"

test("config opens a bun process and copies the svelte bundle", () => {
	const config = makeElectrobunConfig({
		version: "2026.3.33",
		codesign: true,
		notarize: true,
		baseUrl: "https://github.com/flazouh/acepe/releases/latest/download",
	})
	expect(config.build.bun.entrypoint).toBe("src/bun/main.ts")
	expect(config.build.copy["build/"]).toBe("views/mainview/")
	expect(config.build.buildFolder).toBe("electrobun-build")
	expect(config.build.artifactFolder).toBe("electrobun-artifacts")
	expect(config.app.identifier).toBe("com.acepe.app")
	expect(config.build.mac.createDmg).toBe(true)
})

test("signed config enables notarisation", () => {
	const config = makeElectrobunConfig({
		version: "2026.3.33",
		codesign: true,
		notarize: true,
		baseUrl: "https://example.com/releases",
	})
	expect(config.build.mac.codesign).toBe(true)
	expect(config.build.mac.notarize).toBe(true)
})

test("differential updater is on", () => {
	const config = makeElectrobunConfig({
		version: "2026.3.33",
		codesign: false,
		notarize: false,
		baseUrl: "https://github.com/flazouh/acepe/releases/latest/download",
	})
	expect(config.release.generatePatch).toBe(true)
	expect(config.release.baseUrl).toBe("https://github.com/flazouh/acepe/releases/latest/download")
	expect(config.build.mac.createDmg).toBe(false)
})

test("loadElectrobunConfig reads ACEPE_SIGN from env and skips notarisation without Apple credentials", () => {
	const provider = ConfigProvider.fromEnv({
		env: {
			ACEPE_SIGN: "true",
			ACEPE_VERSION: "2026.4.1",
			ACEPE_BASEURL: "https://example.com/electrobun",
		},
	})
	const config = Effect.runSync(
		loadElectrobunConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(config.app.version).toBe("2026.4.1")
	expect(config.build.mac.codesign).toBe(true)
	expect(config.build.mac.notarize).toBe(false)
	expect(config.build.mac.createDmg).toBe(true)
	expect(config.release.baseUrl).toBe("https://example.com/electrobun")
})

test("loadElectrobunConfig notarises when ACEPE_SIGN and Apple ID credentials are set", () => {
	const provider = ConfigProvider.fromEnv({
		env: {
			ACEPE_SIGN: "true",
			ACEPE_VERSION: "2026.4.1",
			ACEPE_BASEURL: "https://example.com/electrobun",
			ELECTROBUN_APPLEID: "dev@acepe.app",
			ELECTROBUN_APPLEIDPASS: "app-specific-password",
			ELECTROBUN_TEAMID: "GD7PWQBWJV",
		},
	})
	const config = Effect.runSync(
		loadElectrobunConfig.pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
	)
	expect(config.build.mac.codesign).toBe(true)
	expect(config.build.mac.notarize).toBe(true)
	expect(config.build.mac.createDmg).toBe(true)
})

test("release builds use the stable electrobun channel", () => {
	expect(electrobunReleaseChannel).toBe("stable")
	expect(electrobunCliBuildArgs).toEqual(["build", `--env=${electrobunReleaseChannel}`])
})
