import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Vitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import * as Result from "effect/Result"

import { runForbidLegacyDependencies } from "./cli.ts"

const TestPlatform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

Vitest.layer(TestPlatform)("runForbidLegacyDependencies", (it) => {
	it.effect("fails a tree that still lists neverthrow", () =>
		Effect.gen(function*() {
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const root = yield* fs.makeTempDirectoryScoped()
			yield* fs.writeFileString(
				path.join(root, "package.json"),
				'{"optionalDependencies":{"neverthrow":"8.2.0"}}'
			)
			const result = yield* Effect.result(runForbidLegacyDependencies(root))
			Vitest.assert.isTrue(Result.isFailure(result))
			if (Result.isFailure(result)) {
				Vitest.assert.strictEqual(result.failure._tag, "ForbiddenLegacyDependencies")
				if (result.failure._tag === "ForbiddenLegacyDependencies") {
					const violation = result.failure.violations[0]
					Vitest.assert.isDefined(violation)
					Vitest.assert.strictEqual(violation.field, "optionalDependencies")
				}
			}
		})
	)
})
