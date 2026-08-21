import * as Vitest from "@effect/vitest"
import { computeDiffStats, rustLines } from "./diffStats.ts"

Vitest.describe("rustLines", () => {
	Vitest.it("returns no lines for the empty string", () => {
		Vitest.assert.deepStrictEqual(rustLines(""), [])
	})

	Vitest.it("drops a trailing newline the way Rust str::lines does", () => {
		Vitest.assert.deepStrictEqual(rustLines("a\nb\n"), ["a", "b"])
		Vitest.assert.deepStrictEqual(rustLines("a\nb"), ["a", "b"])
	})

	Vitest.it("keeps a single empty line for a lone newline", () => {
		Vitest.assert.deepStrictEqual(rustLines("\n"), [""])
	})

	Vitest.it("strips carriage returns from CRLF lines", () => {
		Vitest.assert.deepStrictEqual(rustLines("a\r\nb"), ["a", "b"])
	})
})

Vitest.describe("computeDiffStats", () => {
	Vitest.it("counts every line as added when there is no previous content", () => {
		Vitest.assert.deepStrictEqual(computeDiffStats(null, "one\ntwo\n"), {
			linesAdded: 2,
			linesRemoved: 0
		})
	})

	Vitest.it("uses set difference, matching CheckpointManager::compute_diff_stats", () => {
		Vitest.assert.deepStrictEqual(computeDiffStats("a\nb\n", "b\nc\n"), {
			linesAdded: 1,
			linesRemoved: 1
		})
	})
})
