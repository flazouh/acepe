import type { GitCommitData, GitPrData, GitViewerFile } from "@acepe/ui";
import type { CommitDiff, PrDiff } from "../../types/github-integration.js";
import { isCommitDiff } from "../../types/github-integration.js";

export type DiffViewerData =
	| { readonly type: "commit"; readonly commit: GitCommitData }
	| { readonly type: "pr"; readonly pr: GitPrData };

export function mapDiffFilesToGitViewerFiles(
	files: readonly (CommitDiff["files"][number] | PrDiff["files"][number])[]
): GitViewerFile[] {
	return files.map((file) => ({
		path: file.path,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
		patch: file.patch,
	}));
}

export function buildDiffViewerData(diff: CommitDiff | PrDiff | null): DiffViewerData | null {
	if (!diff) return null;

	if (isCommitDiff(diff)) {
		return {
			type: "commit",
			commit: {
				sha: diff.sha,
				shortSha: diff.shortSha,
				message: diff.message,
				messageBody: diff.messageBody,
				author: diff.author,
				authorEmail: diff.authorEmail,
				date: diff.date,
				files: mapDiffFilesToGitViewerFiles(diff.files),
				githubUrl: diff.repoContext
					? `https://github.com/${diff.repoContext.owner}/${diff.repoContext.repo}/commit/${diff.sha}`
					: undefined,
			},
		};
	}

	return {
		type: "pr",
		pr: {
			number: diff.pr.number,
			title: diff.pr.title,
			author: diff.pr.author,
			state: diff.pr.state,
			description: diff.pr.description,
			files: mapDiffFilesToGitViewerFiles(diff.files),
			githubUrl: `https://github.com/${diff.repoContext.owner}/${diff.repoContext.repo}/pull/${diff.pr.number}`,
		},
	};
}
