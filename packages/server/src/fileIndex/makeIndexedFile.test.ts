import * as Vitest from "@effect/vitest"
import { makeIndexedFile } from "./makeIndexedFile.ts"

Vitest.describe("makeIndexedFile", () => {
	Vitest.it("builds metadata without reading file contents", () => {
		const file = makeIndexedFile("subdir/nested.js")
		Vitest.assert.strictEqual(file.path, "subdir/nested.js")
		Vitest.assert.strictEqual(file.extension, "js")
		Vitest.assert.strictEqual(file.lineCount, 0)
		Vitest.assert.strictEqual(file.gitStatus, null)
	})
})
