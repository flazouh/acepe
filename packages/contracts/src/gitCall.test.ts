import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
	GitCallCheckoutBranchRequest,
	GitCallCommitResult,
	GitCallLogRequest,
	GitCallPanelStatusResult,
	GitCallRequest,
	GitCallResult,
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
})
