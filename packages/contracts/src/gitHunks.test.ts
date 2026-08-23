import { describe, expect, it } from "bun:test"

import {
	applyHunks,
	parseUnifiedHunks,
	revertHunkInContent,
	revertHunksInContent,
} from "./gitHunks.ts"

const OLD = ["line1", "line2", "line3", "line4", "line5"].join("\n") + "\n"
const NEW = ["line1", "LINE2", "line3", "line4", "LINE5"].join("\n") + "\n"

const PATCH = `--- a/notes.md
+++ b/notes.md
@@ -1,3 +1,3 @@
 line1
-line2
+LINE2
 line3
@@ -4,2 +4,2 @@
 line4
-line5
+LINE5
`

describe("parseUnifiedHunks", () => {
	it("reads two @@ hunks in file order", () => {
		const hunks = parseUnifiedHunks(PATCH)
		expect(hunks.length).toBe(2)
		expect(hunks[0]?.index).toBe(0)
		expect(hunks[0]?.oldLines).toEqual(["line1", "line2", "line3"])
		expect(hunks[0]?.newLines).toEqual(["line1", "LINE2", "line3"])
		expect(hunks[1]?.index).toBe(1)
		expect(hunks[1]?.oldLines).toEqual(["line4", "line5"])
		expect(hunks[1]?.newLines).toEqual(["line4", "LINE5"])
	})
})

describe("applyHunks", () => {
	it("rebuilds the new file from HEAD plus the unified patch", () => {
		expect(applyHunks(OLD, PATCH)).toBe(NEW)
	})
})

describe("revertHunkInContent", () => {
	it("keeps hunk 0 and restores hunk 1 to the old side", () => {
		const next = revertHunkInContent(NEW, PATCH, 1)
		expect(next).toBe(["line1", "LINE2", "line3", "line4", "line5"].join("\n") + "\n")
	})

	it("keeps hunk 1 and restores hunk 0 to the old side", () => {
		const next = revertHunkInContent(NEW, PATCH, 0)
		expect(next).toBe(["line1", "line2", "line3", "line4", "LINE5"].join("\n") + "\n")
	})
})

describe("revertHunksInContent", () => {
	it("restores both hunks in any listed order", () => {
		expect(revertHunksInContent(NEW, PATCH, [0, 1])).toBe(OLD)
		expect(revertHunksInContent(NEW, PATCH, [1, 0])).toBe(OLD)
	})
})
