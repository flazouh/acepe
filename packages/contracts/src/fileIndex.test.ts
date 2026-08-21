import { describe, expect, it } from "bun:test"
import * as Schema from "effect/Schema"

import { FileGitStatus, FileIndexUpdate, IndexedFile, ProjectIndex } from "./fileIndex.ts"

const decodeFile = Schema.decodeUnknownSync(IndexedFile)
const decodeIndex = Schema.decodeUnknownSync(ProjectIndex)
const decodeUpdate = Schema.decodeUnknownSync(FileIndexUpdate)
const decodeStatus = Schema.decodeUnknownSync(FileGitStatus)

describe("IndexedFile", () => {
	it("decodes a scanned file with no git status", () => {
		const file = decodeFile({
			path: "src/main.ts",
			extension: "ts",
			lineCount: 0,
			gitStatus: null,
		})
		expect(file.path).toBe("src/main.ts")
		expect(file.extension).toBe("ts")
		expect(file.lineCount).toBe(0)
		expect(file.gitStatus).toBeNull()
	})
})

describe("FileGitStatus", () => {
	it("decodes a modified-file badge", () => {
		const status = decodeStatus({
			path: "src/main.ts",
			status: "M",
			insertions: 2,
			deletions: 1,
		})
		expect(status.status).toBe("M")
		expect(status.insertions).toBe(2)
		expect(status.deletions).toBe(1)
	})
})

describe("ProjectIndex", () => {
	it("decodes an empty project index", () => {
		const index = decodeIndex({
			projectPath: "/tmp/acepe",
			files: [],
			gitStatus: [],
			totalFiles: 0,
			totalLines: 0,
		})
		expect(index.projectPath).toBe("/tmp/acepe")
		expect(index.totalFiles).toBe(0)
	})
})

describe("FileIndexUpdate", () => {
	it("decodes an upsert and a remove", () => {
		const upsert = decodeUpdate({
			type: "upsert",
			relativePath: "src/new.ts",
		})
		const remove = decodeUpdate({
			type: "remove",
			relativePath: "src/old.ts",
		})
		expect(upsert.type).toBe("upsert")
		if (upsert.type === "upsert") {
			expect(upsert.relativePath).toBe("src/new.ts")
		}
		expect(remove.type).toBe("remove")
		if (remove.type === "remove") {
			expect(remove.relativePath).toBe("src/old.ts")
		}
	})
})
