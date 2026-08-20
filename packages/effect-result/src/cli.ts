import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { checkForbiddenLegacyDependencies } from "./forbidLegacyDependencies.ts"

const Platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

export { checkForbiddenLegacyDependencies as runForbidLegacyDependencies }

if (import.meta.main) {
	BunRuntime.runMain(
		Effect.gen(function*() {
			const path = yield* Path.Path
			const root = path.resolve(import.meta.dir, "..", "..", "..")
			yield* checkForbiddenLegacyDependencies(root)
		}).pipe(
			// @effect-diagnostics-next-line strictEffectProvide:off
			Effect.provide(Platform)
		)
	)
}
