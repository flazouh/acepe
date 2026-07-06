import { describe, expect, it } from "bun:test";

import {
	createEmptyStateBranchMetadataLoader,
	type EmptyStateBranchDiffStats,
	type EmptyStateBranchMetadataGitClient,
	type EmptyStateBranchMetadataScheduler,
} from "../empty-state-branch-metadata-loader.js";

class DeferredMatch<T> {
	private ok: ((value: T) => void) | null = null;
	private err: ((error: unknown) => void) | null = null;

	match(onOk: (value: T) => void, onErr: (error: unknown) => void): void {
		this.ok = onOk;
		this.err = onErr;
	}

	resolve(value: T): void {
		this.ok?.(value);
	}

	reject(error: unknown): void {
		this.err?.(error);
	}
}

function createWriterState() {
	const state = {
		resetCount: 0,
		isGitRepo: null as boolean | null,
		currentBranch: null as string | null,
		diffStats: null as EmptyStateBranchDiffStats | null,
		writer: {
			reset() {
				state.resetCount += 1;
				state.isGitRepo = null;
				state.currentBranch = null;
				state.diffStats = null;
			},
			setIsGitRepo(value: boolean) {
				state.isGitRepo = value;
			},
			setCurrentBranch(value: string | null) {
				state.currentBranch = value;
			},
			setDiffStats(value: EmptyStateBranchDiffStats | null) {
				state.diffStats = value;
			},
		},
	};
	return state;
}

describe("empty-state branch metadata loader", () => {
	it("loads repo, branch, and diff stats when details are requested", () => {
		const state = createWriterState();
		const repo = new DeferredMatch<boolean>();
		const branch = new DeferredMatch<string | null>();
		const stats = new DeferredMatch<EmptyStateBranchDiffStats>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo,
			currentBranch: () => branch,
			diffStats: () => stats,
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo", { loadDetails: true });
		repo.resolve(true);
		branch.resolve("main");
		stats.resolve({ insertions: 3, deletions: 1 });

		expect(state.resetCount).toBe(1);
		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe("main");
		expect(state.diffStats).toEqual({ insertions: 3, deletions: 1 });
	});

	it("skips branch and diff details during the default automatic refresh", () => {
		const state = createWriterState();
		const repo = new DeferredMatch<boolean>();
		let branchCalls = 0;
		let diffStatsCalls = 0;
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo,
			currentBranch: () => {
				branchCalls += 1;
				return new DeferredMatch<string | null>();
			},
			diffStats: () => {
				diffStatsCalls += 1;
				return new DeferredMatch<EmptyStateBranchDiffStats>();
			},
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo");
		repo.resolve(true);

		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe(null);
		expect(state.diffStats).toBe(null);
		expect(branchCalls).toBe(0);
		expect(diffStatsCalls).toBe(0);
	});

	it("marks non-repos without loading branch details", () => {
		const state = createWriterState();
		let branchCalls = 0;
		const repo = new DeferredMatch<boolean>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo,
			currentBranch: () => {
				branchCalls += 1;
				return new DeferredMatch<string | null>();
			},
			diffStats: () => new DeferredMatch<EmptyStateBranchDiffStats>(),
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo");
		repo.resolve(false);

		expect(state.isGitRepo).toBe(false);
		expect(branchCalls).toBe(0);
	});

	it("ignores stale responses after a newer refresh starts", () => {
		const state = createWriterState();
		const firstRepo = new DeferredMatch<boolean>();
		const secondRepo = new DeferredMatch<boolean>();
		const branch = new DeferredMatch<string | null>();
		const stats = new DeferredMatch<EmptyStateBranchDiffStats>();
		let isRepoCalls = 0;
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => {
				isRepoCalls += 1;
				return isRepoCalls === 1 ? firstRepo : secondRepo;
			},
			currentBranch: () => branch,
			diffStats: () => stats,
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/first", { loadDetails: true });
		loader.refresh("/second", { loadDetails: true });
		firstRepo.resolve(true);
		expect(state.isGitRepo).toBe(null);

		secondRepo.resolve(true);
		branch.resolve("second-branch");
		stats.resolve({ insertions: 1, deletions: 0 });

		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe("second-branch");
		expect(state.diffStats).toEqual({ insertions: 1, deletions: 0 });
	});

	it("can defer metadata loading until the scheduler runs", () => {
		const state = createWriterState();
		const scheduledCallbacks: Array<() => void> = [];
		let isRepoCalls = 0;
		const repo = new DeferredMatch<boolean>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => {
				isRepoCalls += 1;
				return repo;
			},
			currentBranch: () => new DeferredMatch<string | null>(),
			diffStats: () => new DeferredMatch<EmptyStateBranchDiffStats>(),
		};
		const scheduler: EmptyStateBranchMetadataScheduler = (callback) => {
			scheduledCallbacks.push(callback);
			return () => undefined;
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
			scheduler,
		});

		loader.refresh("/repo");

		expect(state.resetCount).toBe(1);
		expect(isRepoCalls).toBe(0);

		scheduledCallbacks[0]?.();
		repo.resolve(false);

		expect(isRepoCalls).toBe(1);
		expect(state.isGitRepo).toBe(false);
	});

	it("cancels a deferred metadata load when reset runs before the scheduler", () => {
		const state = createWriterState();
		const scheduledCallbacks: Array<() => void> = [];
		let cancelCalls = 0;
		let isRepoCalls = 0;
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => {
				isRepoCalls += 1;
				return new DeferredMatch<boolean>();
			},
			currentBranch: () => new DeferredMatch<string | null>(),
			diffStats: () => new DeferredMatch<EmptyStateBranchDiffStats>(),
		};
		const scheduler: EmptyStateBranchMetadataScheduler = (callback) => {
			scheduledCallbacks.push(callback);
			return () => {
				cancelCalls += 1;
			};
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
			scheduler,
		});

		loader.refresh("/repo");
		loader.reset();
		scheduledCallbacks[0]?.();

		expect(cancelCalls).toBe(1);
		expect(isRepoCalls).toBe(0);
		expect(state.resetCount).toBe(2);
	});
});
