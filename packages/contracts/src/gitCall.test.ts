import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
	GitCallCheckoutBranchRequest,
	GitCallCommitResult,
	GitCallLogRequest,
	GitCallPanelStatusResult,
	GitCallListPullRequestsRequest,
	GitCallRepoContextResult,
	GitCallRequest,
	GitCallResult,
	GitCallWorkingFileDiffRequest,
} from "./gitCall.ts"

describe("GitCallRequest", () => {
	it("decodes a branch/checkout op by its op discriminant", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.checkoutBranch",
				projectPath: "/tmp/acepe",
				branch: "main",
			}),
		)
		expect(decoded).toEqual({ op: "git.checkoutBranch", projectPath: "/tmp/acepe", branch: "main" })
	})

	it("decodes checkoutBranch with the optional create flag", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallCheckoutBranchRequest)({
				op: "git.checkoutBranch",
				projectPath: "/tmp/acepe",
				branch: "feat/new",
				create: true,
			}),
		)
		expect(decoded.create).toBe(true)
	})

	it("decodes a stage/commit op by its op discriminant", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.commit",
				projectPath: "/tmp/acepe",
				message: "fix: thing",
			}),
		)
		expect(decoded).toEqual({ op: "git.commit", projectPath: "/tmp/acepe", message: "fix: thing" })
	})

	it("decodes log with an optional limit", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallLogRequest)({
				op: "git.log",
				projectPath: "/tmp/acepe",
				limit: 10,
			}),
		)
		expect(decoded.limit).toBe(10)
	})

	it("decodes a push/pull/remote op by its op discriminant", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.push",
				projectPath: "/tmp/acepe",
			}),
		)
		expect(decoded).toEqual({ op: "git.push", projectPath: "/tmp/acepe" })
	})

	it("decodes a stash op with its index", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.stashPop",
				projectPath: "/tmp/acepe",
				index: 0,
			}),
		)
		expect(decoded).toEqual({ op: "git.stashPop", projectPath: "/tmp/acepe", index: 0 })
	})

	it("decodes a worktree lifecycle op with its own path field", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.worktreeRemove",
				worktreePath: "/tmp/acepe-wt/clever-falcon",
				force: true,
			}),
		)
		expect(decoded).toEqual({
			op: "git.worktreeRemove",
			worktreePath: "/tmp/acepe-wt/clever-falcon",
			force: true,
		})
	})

	it("decodes a runWorktreeSetup request with two distinct path fields", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.runWorktreeSetup",
				worktreePath: "/tmp/acepe-wt/clever-falcon",
				projectPath: "/tmp/acepe",
			}),
		)
		expect(decoded).toEqual({
			op: "git.runWorktreeSetup",
			worktreePath: "/tmp/acepe-wt/clever-falcon",
			projectPath: "/tmp/acepe",
		})
	})

	it("decodes a discardPreparedWorktreeSessionLaunch request with no path field", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.discardPreparedWorktreeSessionLaunch",
				launchToken: "token-1",
				removeWorktree: true,
			}),
		)
		expect(decoded).toEqual({
			op: "git.discardPreparedWorktreeSessionLaunch",
			launchToken: "token-1",
			removeWorktree: true,
		})
	})

	it("decodes a runStackedAction op with its optional pr title/body", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.runStackedAction",
				projectPath: "/tmp/acepe",
				action: "commit_push_pr",
				commitMessage: "fix: thing",
				prTitle: "Fix thing",
			}),
		)
		expect(decoded).toEqual({
			op: "git.runStackedAction",
			projectPath: "/tmp/acepe",
			action: "commit_push_pr",
			commitMessage: "fix: thing",
			prTitle: "Fix thing",
		})
	})

	it("decodes a prDetails/prChecks/mergePr op with its prNumber", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.mergePr",
				projectPath: "/tmp/acepe",
				prNumber: 42,
				strategy: "squash",
			}),
		)
		expect(decoded).toEqual({
			op: "git.mergePr",
			projectPath: "/tmp/acepe",
			prNumber: 42,
			strategy: "squash",
		})
	})

	it("rejects a blank projectPath", () => {
		const decoded = Effect.runSyncExit(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.isRepo",
				projectPath: "   ",
			}),
		)
		expect(decoded._tag).toBe("Failure")
	})

	it("rejects an unknown op", () => {
		const decoded = Effect.runSyncExit(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.notARealOp",
				projectPath: "/tmp/acepe",
			}),
		)
		expect(decoded._tag).toBe("Failure")
	})
})

describe("GitCallResult", () => {
	it("decodes a panelStatus result's file rows", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallPanelStatusResult)({
				op: "git.panelStatus",
				files: [
					{
						path: "a.ts",
						indexStatus: "M",
						worktreeStatus: null,
						indexInsertions: 1,
						indexDeletions: 0,
						worktreeInsertions: 0,
						worktreeDeletions: 0,
					},
				],
			}),
		)
		expect(decoded.files).toHaveLength(1)
		expect(decoded.files[0]?.path).toBe("a.ts")
	})

	it("decodes a commit result", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallCommitResult)({
				op: "git.commit",
				sha: "abc123",
				shortSha: "abc123",
			}),
		)
		expect(decoded.sha).toBe("abc123")
	})

	it("round-trips a union member through the GitCallResult union", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.isRepo",
				isRepo: true,
			}),
		)
		expect(decoded).toEqual({ op: "git.isRepo", isRepo: true })
	})

	it("decodes a remoteStatus result", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.remoteStatus",
				ahead: 1,
				behind: 2,
				remote: "origin",
				trackingBranch: "origin/main",
			}),
		)
		expect(decoded).toEqual({
			op: "git.remoteStatus",
			ahead: 1,
			behind: 2,
			remote: "origin",
			trackingBranch: "origin/main",
		})
	})

	it("decodes a stashList result's entries", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.stashList",
				entries: [{ index: 0, message: "WIP on main", date: "2 hours ago" }],
			}),
		)
		expect(decoded).toEqual({
			op: "git.stashList",
			entries: [{ index: 0, message: "WIP on main", date: "2 hours ago" }],
		})
	})

	it("decodes a prepareWorktreeSessionLaunch result's nested worktree info", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.prepareWorktreeSessionLaunch",
				launch: {
					launchToken: "token-1",
					sequenceId: 1,
					worktree: {
						name: "clever-falcon",
						branch: "clever-falcon",
						directory: "/tmp/acepe-wt/clever-falcon",
						origin: "acepe",
					},
				},
			}),
		)
		expect(decoded.op).toBe("git.prepareWorktreeSessionLaunch")
		if (decoded.op === "git.prepareWorktreeSessionLaunch") {
			expect(decoded.launch.worktree.origin).toBe("acepe")
		}
	})

	it("decodes a runWorktreeSetup result's per-command outputs", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.runWorktreeSetup",
				result: {
					success: false,
					outputs: [{ command: "bun install", stdout: "", stderr: "boom", exitCode: 1 }],
					error: "Command failed: bun install",
				},
			}),
		)
		expect(decoded.op).toBe("git.runWorktreeSetup")
		if (decoded.op === "git.runWorktreeSetup") {
			expect(decoded.result.success).toBe(false)
			expect(decoded.result.outputs[0]?.exitCode).toBe(1)
		}
	})

	it("decodes a runStackedAction result's nested commit/push/pr steps", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.runStackedAction",
				result: {
					action: "commit_push_pr",
					commit: { status: "created", commitSha: "abc123", subject: "fix: thing" },
					push: { status: "pushed", branch: "feature/x", upstreamBranch: "feature/x" },
					pr: {
						status: "created",
						url: "https://github.com/flazouh/acepe/pull/1",
						number: 1,
						title: "Fix thing",
						baseBranch: "main",
						headBranch: "feature/x",
					},
				},
			}),
		)
		expect(decoded.op).toBe("git.runStackedAction")
		if (decoded.op === "git.runStackedAction") {
			expect(decoded.result.pr.status).toBe("created")
			expect(decoded.result.pr.number).toBe(1)
		}
	})

	it("decodes a prDetails result's nested commits", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.prDetails",
				details: {
					number: 235,
					title: "fix(website): remove landing announcement banner",
					body: "",
					state: "MERGED",
					url: "https://github.com/flazouh/acepe/pull/235",
					isDraft: false,
					additions: 1,
					deletions: 1,
					commits: [{ oid: "abc", messageHeadline: "fix it", additions: 1, deletions: 1 }],
				},
			}),
		)
		expect(decoded.op).toBe("git.prDetails")
		if (decoded.op === "git.prDetails") {
			expect(decoded.details.state).toBe("MERGED")
			expect(decoded.details.commits).toHaveLength(1)
		}
	})

	it("decodes a ciJobDetails result's nested steps", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.ciJobDetails",
				details: {
					id: 1,
					name: "build",
					status: "completed",
					conclusion: "success",
					steps: [{ number: 1, name: "checkout", status: "completed", conclusion: "success", log: "" }],
				},
			}),
		)
		expect(decoded.op).toBe("git.ciJobDetails")
		if (decoded.op === "git.ciJobDetails") {
			expect(decoded.details.steps).toHaveLength(1)
		}
	})
})

describe("GitCall github ops", () => {
	it("decodes git.repoContext's result", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRepoContextResult)({
				op: "git.repoContext",
				context: {
					owner: "flazouh",
					repo: "acepe",
					remoteUrl: "https://github.com/flazouh/acepe.git",
				},
			}),
		)
		expect(decoded.context.owner).toBe("flazouh")
	})

	it("decodes git.commitDiff's result with a null repo context", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallResult)({
				op: "git.commitDiff",
				diff: {
					sha: "abcdef1234567890abcdef1234567890abcdef12",
					shortSha: "abcdef1",
					message: "fix: things",
					messageBody: "",
					author: "Alex",
					authorEmail: "alex@example.com",
					date: "2026-08-29T00:00:00Z",
					files: [
						{
							path: "src/a.ts",
							status: "modified",
							additions: 1,
							deletions: 0,
							patch: "@@\n+a\n",
						},
					],
					repoContext: null,
				},
			}),
		)
		expect(decoded.op).toBe("git.commitDiff")
	})

	it("decodes git.listPullRequests with its state filter and limit", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallListPullRequestsRequest)({
				op: "git.listPullRequests",
				projectPath: "/tmp/acepe",
				owner: "flazouh",
				repo: "acepe",
				state: "all",
				limit: 30,
			}),
		)
		expect(decoded.state).toBe("all")
	})

	it("rejects a git.workingFileDiff status outside the four-way literal", () => {
		const decoded = Effect.runSyncExit(
			Schema.decodeUnknownEffect(GitCallWorkingFileDiffRequest)({
				op: "git.workingFileDiff",
				projectPath: "/tmp/acepe",
				filePath: "src/a.ts",
				staged: false,
				status: "conflicted",
				additions: 0,
				deletions: 0,
			}),
		)
		expect(decoded._tag).toBe("Failure")
	})

	it("routes the new ops through the request union's op discriminant", () => {
		const decoded = Effect.runSync(
			Schema.decodeUnknownEffect(GitCallRequest)({
				op: "git.prDiff",
				projectPath: "/tmp/acepe",
				owner: "flazouh",
				repo: "acepe",
				prNumber: 42,
			}),
		)
		expect(decoded.op).toBe("git.prDiff")
	})
})
