import * as Vitest from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import { parseGitignore } from "./gitignore.ts"
import { applyFileIndexUpdates, buildProjectIndex, sortIndexedFiles } from "./incremental.ts"
import { indexedFileFromRelativePath } from "./scanner.ts"
import type { IndexedFile } from "./Schemas.ts"

Vitest.describe("sortIndexedFiles", () => {
	Vitest.it.effect("puts git-changed files first, then sorts by path", () =>
		Effect.gen(function*() {
			const clean = yield* indexedFileFromRelativePath("z.ts")
			const changed: IndexedFile = {
				path: "b.ts",
				extension: "ts",
				lineCount: 0,
				gitStatus: {
					path: "b.ts",
					status: "M",
					insertions: 1,
					deletions: 0
				}
			}
			const other = yield* indexedFileFromRelativePath("a.ts")
			const sorted = sortIndexedFiles([clean, other, changed])
			Vitest.assert.deepStrictEqual(Arr.map(sorted, (file) => file.path), [
				"b.ts",
				"a.ts",
				"z.ts"
			])
		})
	)
})

Vitest.describe("buildProjectIndex", () => {
	Vitest.it.effect("counts files and lines after sort", () =>
		Effect.gen(function*() {
			const first = yield* indexedFileFromRelativePath("b.ts")
			const second: IndexedFile = {
				path: "a.ts",
				extension: "ts",
				lineCount: 4,
				gitStatus: null
			}
			const index = yield* buildProjectIndex("/tmp/project", [first, second], [])
			Vitest.assert.strictEqual(index.totalFiles, 2)
			Vitest.assert.strictEqual(index.totalLines, 4)
			Vitest.assert.strictEqual(index.files[0]?.path, "a.ts")
		})
	)
})

Vitest.describe("applyFileIndexUpdates", () => {
	Vitest.it.effect("upserts and removes without walking the tree", () =>
		Effect.gen(function*() {
			const existing = yield* indexedFileFromRelativePath("src/keep.ts")
			const stale = yield* indexedFileFromRelativePath("src/gone.ts")
			const index = yield* buildProjectIndex("/tmp/project", [existing, stale], [])
			const next = yield* applyFileIndexUpdates(
				index,
				[
					{ type: "remove", relativePath: "src/gone.ts" },
					{ type: "upsert", relativePath: "src/new.ts" }
				],
				[]
			)
			Vitest.assert.deepStrictEqual(Arr.map(next.files, (file) => file.path), [
				"src/keep.ts",
				"src/new.ts"
			])
			Vitest.assert.strictEqual(next.totalFiles, 2)
		})
	)

	Vitest.it.effect("drops upserts that gitignore would exclude", () =>
		Effect.gen(function*() {
			const existing = yield* indexedFileFromRelativePath("src/keep.ts")
			const index = yield* buildProjectIndex("/tmp/project", [existing], [])
			const next = yield* applyFileIndexUpdates(
				index,
				[{ type: "upsert", relativePath: "ignored.txt" }],
				parseGitignore("ignored.txt\n", "")
			)
			Vitest.assert.deepStrictEqual(Arr.map(next.files, (file) => file.path), [
				"src/keep.ts"
			])
		})
	)
})
