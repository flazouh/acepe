export interface GitViewerFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
	additions: number;
	deletions: number;
	/** Unified diff patch content for this file */
	patch?: string;
}

export interface GitCommitData {
	sha: string;
	shortSha: string;
	message: string;
	messageBody?: string;
	author: string;
	authorEmail?: string;
	date: string;
	files: GitViewerFile[];
	githubUrl?: string;
}

export interface GitPrData {
	number: number;
	title: string;
	author: string;
	state: "open" | "closed" | "merged";
	description?: string;
	files: GitViewerFile[];
	githubUrl?: string;
}
