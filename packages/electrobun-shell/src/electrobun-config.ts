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
			readonly createDmg: boolean
			readonly entitlements: Record<string, boolean | string>
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
		bun: {
			entrypoint: "src/bun/index.ts",
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
			createDmg: input.codesign,
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

/**
 * Whether the QA surface (the injected preload script and the QA socket) is
 * live for this run.
 *
 * Two conditions, and both are load-bearing.
 *
 * `codesign === false` is the safety half, unchanged: a signed release can
 * never expose the QA surface, however loudly the environment asks for it.
 *
 * `requested` is the parity half. This used to be unsigned-implies-QA, which
 * meant a locally built staging app carried instrumentation no release has --
 * the app under test was not the app that ships. A local build is now a
 * faithful stand-in for the release by default, and instrumenting it is an
 * explicit choice (see `qaSurfaceRequested`).
 */
export const qaSurfaceEnabled = (config: AcepeElectrobunConfig, requested: boolean): boolean =>
	config.build.mac.codesign === false && requested === true

/**
 * The explicit opt-in, read from the process environment.
 *
 * Deliberately its own variable rather than a side effect of
 * `ELECTROBUN_QA_APP_ID`: staging sets that id purely to get its own tracer DB
 * and QA-socket name, and must not be instrumented just for asking to be
 * isolated.
 */
export const qaSurfaceRequested = (env: Record<string, string | undefined>): boolean =>
	env.ACEPE_QA_SURFACE === "1"
