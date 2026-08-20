import * as Vitest from "@effect/vitest"

import { decodeUnknown } from "./decodeUnknown.ts"
import { checkForbiddenLegacyDependencies } from "./forbidLegacyDependencies.ts"
import { fromPromise } from "./fromPromise.ts"
import { fromThrowable } from "./fromThrowable.ts"

Vitest.describe("package exports", () => {
	Vitest.it("exports the Effect and Schema equivalents", () => {
		Vitest.assert.strictEqual(typeof fromThrowable, "function")
		Vitest.assert.strictEqual(typeof fromPromise, "function")
		Vitest.assert.strictEqual(typeof decodeUnknown, "function")
		Vitest.assert.strictEqual(typeof checkForbiddenLegacyDependencies, "function")
	})
})
