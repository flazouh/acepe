import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
	emptyGitFileDiff,
	emptyGitFileReview,
	emptyProjectedGitReview,
	GitBlameLine,
	GitFileDiff,
	GitFileReview,
	GitHunkDecision,
	ProjectedGitReview,
} from "./git.ts"
import { ProjectId } from "./ids.ts"

const decodeDiff = Schema.decodeUnknownEffect(GitFileDiff)
const decodeBlame = Schema.decodeUnknownEffect(GitBlameLine)
const decodeDecision = Schema.decodeUnknownEffect(GitHunkDecision)
const decodeFile = Schema.decodeUnknownEffect(GitFileReview)
const decodeProjected = Schema.decodeUnknownEffect(ProjectedGitReview)

const projectId = ProjectId.make("project-1")

describe("GitFileDiff", () => {
	it("decodes old and new content for pierre without extra fields", () => {
		const diff = Effect.runSync(
			decodeDiff({
				oldContent: "alpha\n",
				newContent: "alpha\nbeta\n",
				fileName: "README.md",
			}),
		)
		expect(diff.oldContent).toBe("alpha\n")
		expect(diff.newContent).toBe("alpha\nbeta\n")
		expect(diff.fileName).toBe("README.md")
		expect(Object.keys(diff).sort()).toEqual(["fileName", "newContent", "oldContent"])
	})

	it("decodes a missing old file as null", () => {
		const diff = Effect.runSync(decodeDiff(emptyGitFileDiff))
		expect(diff.oldContent).toBeNull()
		expect(diff.newContent).toBe("")
	})
})

describe("GitBlameLine", () => {
	it("decodes a porcelain blame row", () => {
		const row = Effect.runSync(
			decodeBlame({
				line: 1,
				commit: "abc1234",
				author: "Test User",
				summary: "Seed the review fixture",
			}),
		)
		expect(row.line).toBe(1)
		expect(row.author).toBe("Test User")
	})

	it("rejects a zero line number", () => {
		expect(() =>
			Effect.runSync(
				decodeBlame({
					line: 0,
					commit: "abc1234",
					author: "Test User",
					summary: "Seed",
				}),
			),
		).toThrow()
	})
})

describe("GitHunkDecision", () => {
	it("decodes an accepted hunk", () => {
		const decision = Effect.runSync(
			decodeDecision({
				hunkIndex: 0,
				action: "accepted",
			}),
		)
		expect(decision.hunkIndex).toBe(0)
		expect(decision.action).toBe("accepted")
	})

	it("decodes a rejected hunk", () => {
		const decision = Effect.runSync(
			decodeDecision({
				hunkIndex: 1,
				action: "rejected",
			}),
		)
		expect(decision.action).toBe("rejected")
	})
})

describe("GitFileReview", () => {
	it("starts empty for a path", () => {
		const file = Effect.runSync(decodeFile(emptyGitFileReview("src/main.ts")))
		expect(file.path).toBe("src/main.ts")
		expect(file.diff).toBeNull()
		expect(file.patch).toBe("")
		expect(file.blame).toEqual([])
		expect(file.hunkDecisions).toEqual([])
	})
})

describe("ProjectedGitReview", () => {
	it("starts with null status so a git failure is not a clean tree", () => {
		const review = Effect.runSync(decodeProjected(emptyProjectedGitReview(projectId, 0)))
		expect(review.projectId).toBe(projectId)
		expect(review.status).toBeNull()
		expect(review.files).toEqual([])
	})
})
