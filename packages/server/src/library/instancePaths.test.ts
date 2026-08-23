import * as Vitest from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { instancedPath } from "./instancePaths.ts"

Vitest.layer(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))("no instance", (it) => {
	it.effect("keeps the base path", () =>
		Effect.gen(function*() {
			Vitest.assert.strictEqual(yield* instancedPath("/tmp/base"), "/tmp/base")
		})
	)
})

Vitest.layer(
	ConfigProvider.layer(
		ConfigProvider.fromEnv({ env: { ELECTROBUN_QA_APP_ID: "com.acepe.app.beta" } })
	)
)("instanced", (it) => {
	it.effect("suffixes with the sanitised instance", () =>
		Effect.gen(function*() {
			Vitest.assert.strictEqual(
				yield* instancedPath("/tmp/base"),
				"/tmp/base-com.acepe.app.beta"
			)
		})
	)
})
