import * as Config from "effect/Config"
import * as Effect from "effect/Effect"

export const DEFAULT_APP_ID = "com.acepe.app"

export const qaSocketFileName = (appId: string): string => `${appId}.sock`

export const qaSocketPath = (input: {
	readonly runtimeDir: string
	readonly appId: string
}): string => `${input.runtimeDir}/electrobun-qa/${qaSocketFileName(input.appId)}`

const runtimeDirFlag = Config.string("RUNTIME_DIR").pipe(
	Config.nested("ELECTROBUN_QA"),
	Config.withDefault("/tmp"),
)

const appIdFlag = Config.string("APP_ID").pipe(
	Config.nested("ELECTROBUN_QA"),
	Config.withDefault(DEFAULT_APP_ID),
)

export const loadQaSocketPath = Effect.fn("loadQaSocketPath")(function* () {
	const runtimeDir = yield* runtimeDirFlag
	const appId = yield* appIdFlag
	return qaSocketPath({ runtimeDir, appId })
})
