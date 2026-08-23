import { describe, expect, it } from "bun:test"
import { ProjectId } from "@acepe/contracts"

import { reviewModalViewModel, selectedProjectWorkspaceRoot, gitReviewSnapshotIsNewer, gitReviewFileIsReady } from "./review-state.ts"

describe("reviewModalViewModel", () => {
	it("keeps null status distinct from an empty clean tree", () => {
		const empty = reviewModalViewModel({
			gitReview: null,
			selectedPath: null,
		})
		expect(empty.status).toBeNull()
		const failed = reviewModalViewModel({
			gitReview: {
				sequence: 1,
				projectId: ProjectId.make("project-1"),
				status: null,
				files: [],
			},
			selectedPath: null,
		})
		expect(failed.status).toBeNull()
		const clean = reviewModalViewModel({
			gitReview: {
				sequence: 1,
				projectId: ProjectId.make("project-1"),
				status: [],
				files: [],
			},
			selectedPath: null,
		})
		expect(clean.status).toEqual([])
	})

	it("maps unified patch hunks and pierre file contents from the projection", () => {
		const model = reviewModalViewModel({
			gitReview: {
				sequence: 2,
				projectId: ProjectId.make("project-1"),
				status: [
					{
						path: "notes.md",
						status: "M",
						insertions: 2,
						deletions: 2,
					},
				],
				files: [
					{
						path: "notes.md",
						diff: {
							oldContent: "alpha\n",
							newContent: "alpha\nbeta\n",
							fileName: "notes.md",
						},
						patch: "@@ -1,1 +1,2 @@\n alpha\n+beta\n",
						blame: [
							{
								line: 1,
								commit: "abc1234",
								author: "Test User",
								summary: "Seed",
							},
						],
						hunkDecisions: [{ hunkIndex: 0, action: "accepted" }],
					},
				],
			},
			selectedPath: "notes.md",
		})
		expect(model.files[0]?.oldContent).toBe("alpha\n")
		expect(model.files[0]?.newContent).toBe("alpha\nbeta\n")
		expect(model.files[0]?.fileName).toBe("notes.md")
		expect(model.files[0]?.hunks).toEqual([{ index: 0, action: "accepted" }])
		expect(model.files[0]?.blame[0]?.author).toBe("Test User")
	})

	it("selects the first status path when the controller has not picked a file yet", () => {
		const model = reviewModalViewModel({
			gitReview: {
				sequence: 2,
				projectId: ProjectId.make("project-1"),
				status: [
					{
						path: "notes.md",
						status: "M",
						insertions: 2,
						deletions: 2,
					},
				],
				files: [
					{
						path: "notes.md",
						diff: {
							oldContent: "alpha\n",
							newContent: "alpha\nbeta\n",
							fileName: "notes.md",
						},
						patch: "@@ -1,1 +1,2 @@\n alpha\n+beta\n",
						blame: [],
						hunkDecisions: [],
					},
				],
			},
			selectedPath: null,
		})
		expect(model.selectedPath).toBe("notes.md")
	})

	it("keeps a newer git snapshot when an older refresh arrives late", () => {
		expect(gitReviewSnapshotIsNewer(12, 10)).toBe(false)
		expect(gitReviewSnapshotIsNewer(12, 12)).toBe(true)
		expect(gitReviewSnapshotIsNewer(12, 13)).toBe(true)
	})

	it("treats a file as ready when the projection already has pierre contents and a patch", () => {
		expect(
			gitReviewFileIsReady(
				{
					sequence: 2,
					projectId: ProjectId.make("project-1"),
					status: [],
					files: [
						{
							path: "notes.md",
							diff: {
								oldContent: "alpha\n",
								newContent: "alpha\nbeta\n",
								fileName: "notes.md",
							},
							patch: "@@ -1,1 +1,2 @@\n alpha\n+beta\n",
							blame: [],
							hunkDecisions: [],
						},
					],
				},
				"notes.md",
			),
		).toBe(true)
		expect(
			gitReviewFileIsReady(
				{
					sequence: 2,
					projectId: ProjectId.make("project-1"),
					status: [],
					files: [
						{
							path: "notes.md",
							diff: null,
							patch: "",
							blame: [],
							hunkDecisions: [],
						},
					],
				},
				"notes.md",
			),
		).toBe(false)
	})
})

describe("selectedProjectWorkspaceRoot", () => {
	it("reads the workspace root of the selected project from the library snapshot", () => {
		const snapshot = {
			snapshotSequence: 1,
			session: null,
			messages: [],
			turns: [],
			activities: [],
			pendingApprovals: [],
			checkpoints: [],
			projects: [
				{
					projectId: ProjectId.make("project-1"),
					title: "Git review",
					workspaceRoot: "/tmp/acepe-git-review-242",
					createdAt: "2026-08-20T12:00:00.000Z",
					updatedAt: "2026-08-20T12:00:00.000Z",
					deletedAt: null,
					sessionCount: 0,
					gitStatus: [],
				},
			],
			sessions: [],
			settings: [],
			skillsCatalog: null,
			voice: null,
			gitReview: null,
			mcpCatalog: null,
			preconnectionOptions: null,
		}
		expect(selectedProjectWorkspaceRoot(snapshot, null)).toBeNull()
		expect(selectedProjectWorkspaceRoot(snapshot, "missing")).toBeNull()
		expect(selectedProjectWorkspaceRoot(snapshot, "project-1")).toBe(
			"/tmp/acepe-git-review-242",
		)
	})
})
