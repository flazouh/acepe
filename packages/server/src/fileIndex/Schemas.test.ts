import * as Vitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { FileGitStatus, FileIndexUpdate, IndexedFile, ProjectIndex } from "./Schemas.ts"

const decodeFile = Schema.decodeUnknownSync(IndexedFile)
const decodeIndex = Schema.decodeUnknownSync(ProjectIndex)
const decodeUpdate = Schema.decodeUnknownSync(FileIndexUpdate)
const decodeStatus = Schema.decodeUnknownSync(FileGitStatus)

Vitest.describe("IndexedFile", () => {
	Vitest.it("decodes a scanned file with no git status", () => {
		const file = decodeFile({
			path: "src/main.ts",
			extension: "ts",
			lineCount: 0,
			gitStatus: null
		})
		Vitest.assert.strictEqual(file.path, "src/main.ts")
		Vitest.assert.strictEqual(file.extension, "ts")
		Vitest.assert.strictEqual(file.lineCount, 0)
		Vitest.assert.strictEqual(file.gitStatus, null)
	})
})

Vitest.describe("FileGitStatus", () => {
	Vitest.it("decodes a modified-file badge", () => {
		const status = decodeStatus({
			path: "src/main.ts",
			status: "M",
			insertions: 2,
			deletions: 1
		})
		Vitest.assert.strictEqual(status.status, "M")
		Vitest.assert.strictEqual(status.insertions, 2)
		Vitest.assert.strictEqual(status.deletions, 1)
	})
})

Vitest.describe("ProjectIndex", () => {
	Vitest.it("decodes an empty project index", () => {
		const index = decodeIndex({
			projectPath: "/tmp/acepe",
			files: [],
			gitStatus: [],
			totalFiles: 0,
			totalLines: 0
		})
		Vitest.assert.strictEqual(index.projectPath, "/tmp/acepe")
		Vitest.assert.strictEqual(index.totalFiles, 0)
	})
})

Vitest.describe("FileIndexUpdate", () => {
	Vitest.it("decodes an upsert and a remove", () => {
		const upsert = decodeUpdate({
			type: "upsert",
			relativePath: "src/new.ts"
		})
		const remove = decodeUpdate({
			type: "remove",
			relativePath: "src/old.ts"
		})
		Vitest.assert.strictEqual(upsert.type, "upsert")
		if (upsert.type === "upsert") {
			Vitest.assert.strictEqual(upsert.relativePath, "src/new.ts")
		}
		Vitest.assert.strictEqual(remove.type, "remove")
		if (remove.type === "remove") {
			Vitest.assert.strictEqual(remove.relativePath, "src/old.ts")
		}
	})
})
