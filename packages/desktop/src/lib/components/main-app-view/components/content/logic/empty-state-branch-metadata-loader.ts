export interface EmptyStateBranchDiffStats {
	readonly insertions: number;
	readonly deletions: number;
}

interface MatchableResult<T> {
	match(onOk: (value: T) => void, onErr: (error: unknown) => void): unknown;
}

export interface EmptyStateBranchMetadataGitClient {
	isRepo(projectPath: string): MatchableResult<boolean>;
	currentBranch(projectPath: string): MatchableResult<string | null>;
	diffStats(projectPath: string): MatchableResult<EmptyStateBranchDiffStats>;
}

export interface EmptyStateBranchMetadataWriter {
	reset(): void;
	setIsGitRepo(value: boolean): void;
	setCurrentBranch(value: string | null): void;
	setDiffStats(value: EmptyStateBranchDiffStats | null): void;
}

export interface EmptyStateBranchMetadataLoader {
	reset(): void;
	refresh(projectPath: string): void;
}

export function createEmptyStateBranchMetadataLoader(options: {
	readonly gitClient: EmptyStateBranchMetadataGitClient;
	readonly writer: EmptyStateBranchMetadataWriter;
}): EmptyStateBranchMetadataLoader {
	let requestVersion = 0;

	function isCurrent(version: number): boolean {
		return version === requestVersion;
	}

	function reset(): void {
		requestVersion += 1;
		options.writer.reset();
	}

	function refresh(projectPath: string): void {
		requestVersion += 1;
		const currentRequestVersion = requestVersion;
		options.writer.reset();

		void options.gitClient.isRepo(projectPath).match(
			(repo) => {
				if (!isCurrent(currentRequestVersion)) {
					return;
				}

				options.writer.setIsGitRepo(repo);
				if (!repo) {
					return;
				}

				void options.gitClient.currentBranch(projectPath).match(
					(branch) => {
						if (isCurrent(currentRequestVersion)) {
							options.writer.setCurrentBranch(branch);
						}
					},
					() => {
						if (isCurrent(currentRequestVersion)) {
							options.writer.setCurrentBranch(null);
						}
					}
				);

				void options.gitClient.diffStats(projectPath).match(
					(stats) => {
						if (isCurrent(currentRequestVersion)) {
							options.writer.setDiffStats(stats);
						}
					},
					() => {
						if (isCurrent(currentRequestVersion)) {
							options.writer.setDiffStats(null);
						}
					}
				);
			},
			() => {
				if (isCurrent(currentRequestVersion)) {
					options.writer.setIsGitRepo(false);
				}
			}
		);
	}

	return { reset, refresh };
}
