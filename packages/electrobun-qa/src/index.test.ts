import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
	executeCli,
	qaArtifactsForBuild,
	qaPreloadScript,
	qaSurfaceEnabled,
	QA_PRELOAD_METHODS,
	startQaHost,
} from "./index.ts"

describe("index", () => {
	it.effect("exports the adoption API", () =>
		Effect.sync(() => {
			expect(typeof executeCli).toBe("function")
			expect(typeof startQaHost).toBe("function")
			expect(qaSurfaceEnabled({ signed: true })).toBe(false)
			expect(qaArtifactsForBuild({ signed: true }).preload).toBeNull()
			expect(qaArtifactsForBuild({ signed: false }).preload).toBe(qaPreloadScript)
			expect(QA_PRELOAD_METHODS.length).toBe(9)
		}),
	)
})
