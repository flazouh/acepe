import { describe, expect, test } from "bun:test";

import {
	resolveAppSessionItemVisualState,
	type AppSessionItemVisualState,
} from "./app-session-item-visual-state.js";
import type { AppSessionItem } from "./types.js";

function session(overrides: Partial<AppSessionItem> = {}): AppSessionItem {
	const o = overrides;
	return {
		id: o.id ?? "s1",
		title: o.title ?? "Fix auth middleware",
		agentIconSrc: o.agentIconSrc,
		status: o.status,
		isActive: o.isActive,
		timeAgo: o.timeAgo,
		lastActionText: o.lastActionText,
		isStreaming: o.isStreaming,
		insertions: o.insertions,
		deletions: o.deletions,
		projectName: o.projectName,
		projectColor: o.projectColor,
		projectIconSrc: o.projectIconSrc,
		sequenceId: o.sequenceId,
		worktreePath: o.worktreePath,
		worktreeDeleted: o.worktreeDeleted,
		prNumber: o.prNumber,
		prState: o.prState,
	};
}

function resolve(overrides: Partial<AppSessionItem> = {}): AppSessionItemVisualState {
	return resolveAppSessionItemVisualState(session(overrides));
}

describe("resolveAppSessionItemVisualState", () => {
	test("minimal session hides every optional slot", () => {
		const v = resolve();
		expect(v.isActive).toBe(false);
		expect(v.showAgentIcon).toBe(false);
		expect(v.showStreamingDot).toBe(false);
		expect(v.statusDotKind).toBeNull();
		expect(v.showDiffPill).toBe(false);
		expect(v.showProjectBadge).toBe(false);
		expect(v.showWorktreeIcon).toBe(false);
		expect(v.isWorktreeDeleted).toBe(false);
		expect(v.showTimeAgo).toBe(false);
		expect(v.showLastAction).toBe(false);
		expect(v.showPrBadge).toBe(false);
		expect(v.prState).toBeNull();
	});

	test("isActive is surfaced from session.isActive", () => {
		expect(resolve({ isActive: true }).isActive).toBe(true);
		expect(resolve({ isActive: false }).isActive).toBe(false);
	});

	test("agent icon flag tracks agentIconSrc presence", () => {
		expect(resolve({ agentIconSrc: "/icons/x.svg" }).showAgentIcon).toBe(true);
		expect(resolve({ agentIconSrc: "" }).showAgentIcon).toBe(false);
		expect(resolve({ agentIconSrc: undefined }).showAgentIcon).toBe(false);
	});

	test("isStreaming true renders streaming dot and suppresses status dot", () => {
		const v = resolve({ isStreaming: true, status: "done" });
		expect(v.showStreamingDot).toBe(true);
		expect(v.statusDotKind).toBeNull();
	});

	test("status=running also renders streaming dot (legacy path)", () => {
		const v = resolve({ status: "running" });
		expect(v.showStreamingDot).toBe(true);
		expect(v.statusDotKind).toBeNull();
	});

	test("non-streaming statuses map to their dot kind", () => {
		expect(resolve({ status: "done" }).statusDotKind).toBe("done");
		expect(resolve({ status: "error" }).statusDotKind).toBe("error");
		expect(resolve({ status: "unseen" }).statusDotKind).toBe("unseen");
	});

	test("status=idle or question has no status dot", () => {
		expect(resolve({ status: "idle" }).statusDotKind).toBeNull();
		expect(resolve({ status: "question" }).statusDotKind).toBeNull();
	});

	test("diff pill flag requires at least one non-zero diff count", () => {
		expect(resolve({ insertions: 0, deletions: 0 }).showDiffPill).toBe(false);
		expect(resolve({ insertions: 5, deletions: 0 }).showDiffPill).toBe(true);
		expect(resolve({ insertions: 0, deletions: 3 }).showDiffPill).toBe(true);
		expect(resolve({ insertions: 2, deletions: 2 }).showDiffPill).toBe(true);
	});

	test("project badge requires all three of sequenceId, projectName, projectColor", () => {
		expect(
			resolve({ sequenceId: 3, projectName: "Acepe", projectColor: "#fff" }).showProjectBadge
		).toBe(true);
		expect(resolve({ sequenceId: 3, projectName: "Acepe" }).showProjectBadge).toBe(false);
		expect(resolve({ sequenceId: 3, projectColor: "#fff" }).showProjectBadge).toBe(false);
		expect(resolve({ projectName: "Acepe", projectColor: "#fff" }).showProjectBadge).toBe(false);
	});

	test("worktree icon shown when worktreePath is non-empty", () => {
		expect(resolve({ worktreePath: "/wt/x" }).showWorktreeIcon).toBe(true);
		expect(resolve({ worktreePath: "" }).showWorktreeIcon).toBe(false);
		expect(resolve().showWorktreeIcon).toBe(false);
	});

	test("worktree deleted flag tracks worktreeDeleted", () => {
		expect(
			resolve({ worktreePath: "/wt/x", worktreeDeleted: true }).isWorktreeDeleted
		).toBe(true);
		expect(resolve({ worktreePath: "/wt/x" }).isWorktreeDeleted).toBe(false);
	});

	test("timeAgo flag requires a non-empty string", () => {
		expect(resolve({ timeAgo: "2m ago" }).showTimeAgo).toBe(true);
		expect(resolve({ timeAgo: "" }).showTimeAgo).toBe(false);
		expect(resolve().showTimeAgo).toBe(false);
	});

	test("last-action flag requires non-empty lastActionText", () => {
		expect(resolve({ lastActionText: "Read foo.ts" }).showLastAction).toBe(true);
		expect(resolve({ lastActionText: "" }).showLastAction).toBe(false);
		expect(resolve().showLastAction).toBe(false);
	});

	test("pr badge flag defaults prState to OPEN when prNumber is set", () => {
		const v = resolve({ prNumber: 42 });
		expect(v.showPrBadge).toBe(true);
		expect(v.prState).toBe("OPEN");
	});

	test("pr badge uses provided prState", () => {
		expect(resolve({ prNumber: 7, prState: "MERGED" }).prState).toBe("MERGED");
		expect(resolve({ prNumber: 7, prState: "CLOSED" }).prState).toBe("CLOSED");
	});

	test("pr badge hidden when prNumber is absent", () => {
		const v = resolve({ prState: "OPEN" });
		expect(v.showPrBadge).toBe(false);
		expect(v.prState).toBeNull();
	});

	test("desktop-like fixture enables every visual affordance simultaneously", () => {
		const v = resolve({
			isActive: true,
			isStreaming: true,
			agentIconSrc: "/icons/claude.svg",
			insertions: 10,
			deletions: 2,
			projectName: "Acepe",
			projectColor: "#FF5D5A",
			sequenceId: 12,
			worktreePath: "/wt/feat-landing",
			worktreeDeleted: false,
			prNumber: 100,
			prState: "OPEN",
			timeAgo: "2m ago",
			lastActionText: "Read packages/ui/src/components/app-layout/app-session-item.svelte",
		});
		expect(v.isActive).toBe(true);
		expect(v.showAgentIcon).toBe(true);
		expect(v.showStreamingDot).toBe(true);
		expect(v.statusDotKind).toBeNull();
		expect(v.showDiffPill).toBe(true);
		expect(v.showProjectBadge).toBe(true);
		expect(v.showWorktreeIcon).toBe(true);
		expect(v.isWorktreeDeleted).toBe(false);
		expect(v.showTimeAgo).toBe(true);
		expect(v.showLastAction).toBe(true);
		expect(v.showPrBadge).toBe(true);
		expect(v.prState).toBe("OPEN");
	});
});
