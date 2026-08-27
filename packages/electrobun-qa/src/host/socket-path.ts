import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
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

// A DOM read on an idle app answers in milliseconds, so the 5s default is
// generous. The same read while the app runs a live agent turn is not: the
// bridge waits behind the turn, the deadline expires, and QA reports a busy app
// as an unreachable one. Raising the default for everyone would hide a real
// hang, so the deadline is a knob the caller sets for the run that needs it.
const deadlineFlag = Config.int("DEADLINE_MS").pipe(
	Config.nested("ELECTROBUN_QA"),
	Config.withDefault(5_000),
)

export const loadQaDeadline = Effect.fn("loadQaDeadline")(function* () {
	return Duration.millis(yield* deadlineFlag)
})
