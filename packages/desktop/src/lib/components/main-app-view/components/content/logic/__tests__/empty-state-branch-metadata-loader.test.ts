import { fromPromise } from "@acepe/effect-result/fromPromise";
import { describe, expect, it } from "bun:test";

import {
	createEmptyStateBranchMetadataLoader,
	type EmptyStateBranchDiffStats,
	type EmptyStateBranchMetadataGitClient,
	type EmptyStateBranchMetadataScheduler,
} from "../empty-state-branch-metadata-loader.js";

function createDeferredEffect<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return {
		effect: fromPromise(() => promise, (error) => error),
		resolve,
		reject,
	};
}

async function flush(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
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
	it("loads repo, branch, and diff stats when details are requested", async () => {
		const state = createWriterState();
		const repo = createDeferredEffect<boolean>();
		const branch = createDeferredEffect<string | null>();
		const stats = createDeferredEffect<EmptyStateBranchDiffStats>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo.effect,
			currentBranch: () => branch.effect,
			diffStats: () => stats.effect,
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo", { loadDetails: true });
		repo.resolve(true);
		branch.resolve("main");
		stats.resolve({ insertions: 3, deletions: 1 });
		await flush();

		expect(state.resetCount).toBe(1);
		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe("main");
		expect(state.diffStats).toEqual({ insertions: 3, deletions: 1 });
	});

	it("skips branch and diff details during the default automatic refresh", async () => {
		const state = createWriterState();
		const repo = createDeferredEffect<boolean>();
		let branchCalls = 0;
		let diffStatsCalls = 0;
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo.effect,
			currentBranch: () => {
				branchCalls += 1;
				return createDeferredEffect<string | null>().effect;
			},
			diffStats: () => {
				diffStatsCalls += 1;
				return createDeferredEffect<EmptyStateBranchDiffStats>().effect;
			},
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo");
		repo.resolve(true);
		await flush();

		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe(null);
		expect(state.diffStats).toBe(null);
		expect(branchCalls).toBe(0);
		expect(diffStatsCalls).toBe(0);
	});

	it("marks non-repos without loading branch details", async () => {
		const state = createWriterState();
		let branchCalls = 0;
		const repo = createDeferredEffect<boolean>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => repo.effect,
			currentBranch: () => {
				branchCalls += 1;
				return createDeferredEffect<string | null>().effect;
			},
			diffStats: () => createDeferredEffect<EmptyStateBranchDiffStats>().effect,
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/repo");
		repo.resolve(false);
		await flush();

		expect(state.isGitRepo).toBe(false);
		expect(branchCalls).toBe(0);
	});

	it("ignores stale responses after a newer refresh starts", async () => {
		const state = createWriterState();
		const firstRepo = createDeferredEffect<boolean>();
		const secondRepo = createDeferredEffect<boolean>();
		const branch = createDeferredEffect<string | null>();
		const stats = createDeferredEffect<EmptyStateBranchDiffStats>();
		let isRepoCalls = 0;
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => {
				isRepoCalls += 1;
				return isRepoCalls === 1 ? firstRepo.effect : secondRepo.effect;
			},
			currentBranch: () => branch.effect,
			diffStats: () => stats.effect,
		};
		const loader = createEmptyStateBranchMetadataLoader({
			gitClient,
			writer: state.writer,
		});

		loader.refresh("/first", { loadDetails: true });
		loader.refresh("/second", { loadDetails: true });
		firstRepo.resolve(true);
		await flush();
		expect(state.isGitRepo).toBe(null);

		secondRepo.resolve(true);
		branch.resolve("second-branch");
		stats.resolve({ insertions: 1, deletions: 0 });
		await flush();

		expect(state.isGitRepo).toBe(true);
		expect(state.currentBranch).toBe("second-branch");
		expect(state.diffStats).toEqual({ insertions: 1, deletions: 0 });
	});

	it("can defer metadata loading until the scheduler runs", async () => {
		const state = createWriterState();
		const scheduledCallbacks: Array<() => void> = [];
		let isRepoCalls = 0;
		const repo = createDeferredEffect<boolean>();
		const gitClient: EmptyStateBranchMetadataGitClient = {
			isRepo: () => {
				isRepoCalls += 1;
				return repo.effect;
			},
			currentBranch: () => createDeferredEffect<string | null>().effect,
			diffStats: () => createDeferredEffect<EmptyStateBranchDiffStats>().effect,
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
		await flush();

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
				return createDeferredEffect<boolean>().effect;
			},
			currentBranch: () => createDeferredEffect<string | null>().effect,
			diffStats: () => createDeferredEffect<EmptyStateBranchDiffStats>().effect,
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
