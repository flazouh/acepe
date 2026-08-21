import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { qaArtifactsForBuild, qaSurfaceEnabled } from "./build-flag.ts"
import { QA_PRELOAD_METHODS, qaPreloadScript } from "./preload/qa-preload.ts"

describe("build-flag", () => {
	it.effect("enables the QA surface on an unsigned build", () =>
		Effect.sync(() => {
			expect(qaSurfaceEnabled({ signed: false })).toBe(true)
			const artifacts = qaArtifactsForBuild({ signed: false })
			expect(artifacts.host).toBe(true)
			expect(artifacts.preload).toBe(qaPreloadScript)
			const preload = artifacts.preload
			if (preload === null) {
				return
			}
			for (const method of QA_PRELOAD_METHODS) {
				expect(preload.includes(method)).toBe(true)
			}
		}),
	)

	it.effect("drops the preload and host from a signed build", () =>
		Effect.sync(() => {
			expect(qaSurfaceEnabled({ signed: true })).toBe(false)
			const artifacts = qaArtifactsForBuild({ signed: true })
			expect(artifacts.host).toBe(false)
			expect(artifacts.preload).toBeNull()
		}),
	)
})
