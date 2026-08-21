import * as Effect from "effect/Effect";

export interface EmptyStateBranchDiffStats {
	readonly insertions: number;
	readonly deletions: number;
}

export interface EmptyStateBranchMetadataGitClient {
	isRepo(projectPath: string): Effect.Effect<boolean, unknown>;
	currentBranch(projectPath: string): Effect.Effect<string | null, unknown>;
	diffStats(projectPath: string): Effect.Effect<EmptyStateBranchDiffStats, unknown>;
}

export interface EmptyStateBranchMetadataWriter {
	reset(): void;
	setIsGitRepo(value: boolean): void;
	setCurrentBranch(value: string | null): void;
	setDiffStats(value: EmptyStateBranchDiffStats | null): void;
}

export interface EmptyStateBranchMetadataRefreshOptions {
	readonly loadDetails?: boolean;
}

export interface EmptyStateBranchMetadataLoader {
	reset(): void;
	refresh(projectPath: string, options?: EmptyStateBranchMetadataRefreshOptions): void;
}

export type EmptyStateBranchMetadataScheduler = (callback: () => void) => () => void;

const DEFAULT_BRANCH_METADATA_DELAY_MS = 5_000;
const DEFAULT_BRANCH_METADATA_IDLE_TIMEOUT_MS = 5_000;

function runBranchMetadataImmediately(callback: () => void): () => void {
	callback();
	return () => undefined;
}

export function createDelayedBranchMetadataScheduler(
	options: { readonly delayMs?: number; readonly idleTimeoutMs?: number } = {}
): EmptyStateBranchMetadataScheduler {
	const delayMs = options.delayMs ?? DEFAULT_BRANCH_METADATA_DELAY_MS;
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_BRANCH_METADATA_IDLE_TIMEOUT_MS;

	return (callback) => {
		let cancelled = false;
		let delayTimer: ReturnType<typeof setTimeout> | null = null;
		let idleTimer: ReturnType<typeof setTimeout> | null = null;
		let idleCallbackId: number | null = null;

		const run = (): void => {
			if (cancelled) {
				return;
			}
			callback();
		};

		const scheduleIdle = (): void => {
			if (cancelled) {
				return;
			}
			if (typeof window !== "undefined") {
				const schedulingWindow = window as Window & {
					requestIdleCallback?: (
						callback: IdleRequestCallback,
						options?: IdleRequestOptions
					) => number;
					cancelIdleCallback?: (handle: number) => void;
				};
				if (typeof schedulingWindow.requestIdleCallback === "function") {
					idleCallbackId = schedulingWindow.requestIdleCallback(run, {
						timeout: idleTimeoutMs,
					});
					return;
				}
			}
			idleTimer = setTimeout(run, 0);
		};

		delayTimer = setTimeout(scheduleIdle, delayMs);

		return () => {
			cancelled = true;
			if (delayTimer !== null) {
				clearTimeout(delayTimer);
			}
			if (idleTimer !== null) {
				clearTimeout(idleTimer);
			}
			if (idleCallbackId !== null && typeof window !== "undefined") {
				const schedulingWindow = window as Window & {
					cancelIdleCallback?: (handle: number) => void;
				};
				schedulingWindow.cancelIdleCallback?.(idleCallbackId);
			}
		};
	};
}

export function createEmptyStateBranchMetadataLoader(options: {
	readonly gitClient: EmptyStateBranchMetadataGitClient;
	readonly writer: EmptyStateBranchMetadataWriter;
	readonly scheduler?: EmptyStateBranchMetadataScheduler;
}): EmptyStateBranchMetadataLoader {
	let requestVersion = 0;
	let cancelScheduledRefresh: (() => void) | null = null;
	const scheduleRefresh = options.scheduler ?? runBranchMetadataImmediately;

	function isCurrent(version: number): boolean {
		return version === requestVersion;
	}

	function cancelPendingRefresh(): void {
		if (cancelScheduledRefresh === null) {
			return;
		}
		cancelScheduledRefresh();
		cancelScheduledRefresh = null;
	}

	function reset(): void {
		requestVersion += 1;
		cancelPendingRefresh();
		options.writer.reset();
	}

	function refresh(
		projectPath: string,
		refreshOptions: EmptyStateBranchMetadataRefreshOptions = {}
	): void {
		requestVersion += 1;
		const currentRequestVersion = requestVersion;
		const shouldLoadDetails = refreshOptions.loadDetails ?? false;
		cancelPendingRefresh();
		options.writer.reset();

		cancelScheduledRefresh = scheduleRefresh(() => {
			cancelScheduledRefresh = null;
			if (!isCurrent(currentRequestVersion)) {
				return;
			}

			void Effect.runPromise(
				options.gitClient.isRepo(projectPath).pipe(
					Effect.match({
						onSuccess: (repo) => {
							if (!isCurrent(currentRequestVersion)) {
								return;
							}

							options.writer.setIsGitRepo(repo);
							if (!repo || !shouldLoadDetails) {
								return;
							}

							void Effect.runPromise(
								options.gitClient.currentBranch(projectPath).pipe(
									Effect.match({
										onSuccess: (branch) => {
											if (isCurrent(currentRequestVersion)) {
												options.writer.setCurrentBranch(branch);
											}
										},
										onFailure: () => {
											if (isCurrent(currentRequestVersion)) {
												options.writer.setCurrentBranch(null);
											}
										},
									})
								)
							);

							void Effect.runPromise(
								options.gitClient.diffStats(projectPath).pipe(
									Effect.match({
										onSuccess: (stats) => {
											if (isCurrent(currentRequestVersion)) {
												options.writer.setDiffStats(stats);
											}
										},
										onFailure: () => {
											if (isCurrent(currentRequestVersion)) {
												options.writer.setDiffStats(null);
											}
										},
									})
								)
							);
						},
						onFailure: () => {
							if (isCurrent(currentRequestVersion)) {
								options.writer.setIsGitRepo(false);
							}
						},
					})
				)
			);
		});
	}

	return { reset, refresh };
}
