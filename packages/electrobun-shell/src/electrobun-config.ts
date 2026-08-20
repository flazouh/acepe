import * as Config from "effect/Config"
import * as Effect from "effect/Effect"

import { loadSigningPolicy, macEntitlements } from "./signing.ts"
import { svelteBundleCopy } from "./svelte-bundle.ts"
import { defaultReleaseBaseUrl } from "./updater.ts"

export type AcepeElectrobunConfig = {
	readonly app: {
		readonly name: string
		readonly identifier: string
		readonly version: string
	}
	readonly build: {
		readonly mainProcess: "bun"
		readonly bun: {
			readonly entrypoint: string
		}
		readonly copy: Record<string, string>
		readonly buildFolder: string
		readonly artifactFolder: string
		readonly watchIgnore: ReadonlyArray<string>
		readonly mac: {
			readonly codesign: boolean
			readonly notarize: boolean
			readonly bundleCEF: boolean
			readonly entitlements: Record<string, boolean>
		}
	}
	readonly release: {
		readonly baseUrl: string
		readonly generatePatch: boolean
	}
}

export const defaultAppVersion = "2026.3.33"

export const electrobunReleaseChannel = "stable" as const

export const electrobunCliBuildArgs = ["build", `--env=${electrobunReleaseChannel}`] as const

const versionFlag = Config.string("VERSION").pipe(Config.nested("ACEPE"), Config.withDefault(defaultAppVersion))

const baseUrlFlag = Config.string("BASEURL").pipe(Config.nested("ACEPE"), Config.withDefault(defaultReleaseBaseUrl))

export const makeElectrobunConfig = (input: {
	readonly version: string
	readonly codesign: boolean
	readonly notarize: boolean
	readonly baseUrl: string
}): AcepeElectrobunConfig => ({
	app: {
		name: "Acepe",
		identifier: "com.acepe.app",
		version: input.version,
	},
	build: {
		mainProcess: "bun",
		bun: {
			entrypoint: "src/bun/main.ts",
		},
		copy: {
			"build/": svelteBundleCopy["build/"],
		},
		buildFolder: "electrobun-build",
		artifactFolder: "electrobun-artifacts",
		watchIgnore: ["electrobun-build/**", "electrobun-artifacts/**"],
		mac: {
			codesign: input.codesign,
			notarize: input.notarize,
			bundleCEF: false,
			entitlements: macEntitlements,
		},
	},
	release: {
		baseUrl: input.baseUrl,
		generatePatch: true,
	},
})

export const loadElectrobunConfig = Effect.all({
	signing: loadSigningPolicy,
	version: versionFlag,
	baseUrl: baseUrlFlag,
}).pipe(
	Effect.map(({ signing, version, baseUrl }) =>
		makeElectrobunConfig({
			version,
			codesign: signing.codesign,
			notarize: signing.notarize,
			baseUrl,
		}),
	),
)

export const resolveElectrobunConfig = (): AcepeElectrobunConfig => Effect.runSync(loadElectrobunConfig)
