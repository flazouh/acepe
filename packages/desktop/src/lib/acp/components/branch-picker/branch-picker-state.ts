export interface BranchPrefixOption {
	readonly value: string;
}

export function filterBranchesByQuery(
	branches: readonly string[],
	query: string
): readonly string[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return branches;
	return branches.filter((branch) => branch.toLowerCase().includes(normalizedQuery));
}

export function getNormalizedBranchName(branchName: string): string {
	return branchName.trim();
}

export function getFullBranchName(input: {
	prefix: BranchPrefixOption;
	branchName: string;
}): string {
	return input.prefix.value + getNormalizedBranchName(input.branchName);
}

export function branchExists(input: {
	branches: readonly string[];
	fullBranchName: string;
}): boolean {
	return input.branches.some(
		(branch) => branch.toLowerCase() === input.fullBranchName.toLowerCase()
	);
}

export function getNewBranchNameError(input: {
	normalizedBranchName: string;
	fullBranchName: string;
	branches: readonly string[];
}): string | null {
	if (input.normalizedBranchName.length === 0) return null;
	if (branchExists({ branches: input.branches, fullBranchName: input.fullBranchName })) {
		return "Branch already exists";
	}
	if (input.normalizedBranchName.endsWith("/")) return 'Branch name cannot end with "/"';
	if (input.normalizedBranchName.includes(" ")) return "Branch name cannot contain spaces";
	return null;
}

export function canCreateBranch(input: {
	normalizedBranchName: string;
	error: string | null;
	switchingBranch: boolean;
}): boolean {
	return input.normalizedBranchName.length > 0 && !input.error && !input.switchingBranch;
}

export function shouldLoadBranchList(input: {
	branchPopoverOpen: boolean;
	projectPath: string | null;
	isWorktree: boolean;
}): boolean {
	return input.branchPopoverOpen && Boolean(input.projectPath) && !input.isWorktree;
}

export function getWorktreeBranches(currentBranch: string | null): string[] {
	return currentBranch ? [currentBranch] : [];
}
