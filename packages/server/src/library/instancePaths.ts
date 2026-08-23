import * as Config from "effect/Config"
import * as Effect from "effect/Effect"

/**
 * Parallel app instances must not share on-disk fixture state: two processes
 * racing one seed path is a TOCTOU crash (seen live as
 * GitAlreadyRepositoryError, then an EINVAL on a half-written skill file).
 *
 * The same instance key that scopes the QA socket scopes every seed path and
 * the tracer database. One env var, one namespace per instance.
 */
const instanceFlag = Config.string("APP_ID").pipe(
	Config.nested("ELECTROBUN_QA"),
	Config.withDefault("")
)

export const loadInstanceSuffix = Effect.fn("loadInstanceSuffix")(function*() {
	const instance = yield* instanceFlag
	if (instance === "") {
		return ""
	}
	return `-${instance.replace(/[^a-zA-Z0-9.-]/g, "-")}`
})

export const instancedPath = Effect.fn("instancedPath")(function*(base: string) {
	const suffix = yield* loadInstanceSuffix()
	return `${base}${suffix}`
})
