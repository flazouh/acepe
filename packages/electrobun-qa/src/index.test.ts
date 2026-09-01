import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { executeCli, QA_PRELOAD_METHODS, startQaHost } from "./index.ts"

describe("index", () => {
	it.effect("exports the adoption API", () =>
		Effect.sync(() => {
			expect(typeof executeCli).toBe("function")
			expect(typeof startQaHost).toBe("function")
			expect(QA_PRELOAD_METHODS.length).toBe(10)
		}),
	)
})
