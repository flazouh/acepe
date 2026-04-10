<script lang="ts">
/**
 * Git Panel demo for the homepage features section.
 * Interactive staging, committing, and history — all mock data.
 */
import {
	GitPanelLayout,
	type GitStatusFile,
	type GitLogEntry,
	type GitStashEntry,
	type GitRemoteStatus,
} from "@acepe/ui";

const ICON_BASE_PATH = "/svgs/icons";

const allFiles: GitStatusFile[] = [
	{
		path: "src/lib/auth/jwt.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 24,
		deletions: 6,
	},
	{
		path: "src/lib/auth/session.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 8,
		deletions: 18,
	},
	{
		path: "src/middleware/auth.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 12,
		deletions: 4,
	},
	{
		path: "tests/auth.test.ts",
		indexStatus: null,
		worktreeStatus: "untracked",
		additions: 47,
		deletions: 0,
	},
];

let stagedFiles = $state<GitStatusFile[]>([]);
let unstagedFiles = $state<GitStatusFile[]>([...allFiles]);
let commitMessage = $state("");
let activeView = $state<"status" | "history" | "stash">("status");

let remoteStatus = $state<GitRemoteStatus>({
	ahead: 0,
	behind: 0,
	remote: "origin",
	trackingBranch: "origin/feat/jwt-auth",
});

let logEntries = $state<GitLogEntry[]>([
	{
		sha: "9e39f1a0b2c4d5e6",
		shortSha: "9e39f1a",
		message: "feat: add JWT token refresh",
		author: "Alice",
		date: "2h ago",
	},
	{
		sha: "7b2c3d4e5f6a7b8c",
		shortSha: "7b2c3d4",
		message: "fix: session expiry handling",
		author: "Bob",
		date: "5h ago",
	},
	{
		sha: "a1b2c3d4e5f6a7b8",
		shortSha: "a1b2c3d",
		message: "refactor: extract auth module",
		author: "Alice",
		date: "1d ago",
	},
	{
		sha: "f0e1d2c3b4a5f0e1",
		shortSha: "f0e1d2c",
		message: "chore: update jose dependency",
		author: "CI Bot",
		date: "2d ago",
	},
]);

let stashEntries = $state<GitStashEntry[]>([
	{ index: 0, message: "WIP: OAuth integration experiment", date: "3h ago" },
]);

function handleStage(path: string) {
	const file = unstagedFiles.find((f) => f.path === path);
	if (!file) return;
	unstagedFiles = unstagedFiles.filter((f) => f.path !== path);
	stagedFiles = [
		...stagedFiles,
		{
			...file,
			indexStatus:
				file.worktreeStatus === "untracked"
					? "added"
					: (file.worktreeStatus as "modified" | "deleted"),
			worktreeStatus: null,
		},
	];
}

function handleUnstage(path: string) {
	const file = stagedFiles.find((f) => f.path === path);
	if (!file) return;
	stagedFiles = stagedFiles.filter((f) => f.path !== path);
	unstagedFiles = [
		...unstagedFiles,
		{
			...file,
			worktreeStatus:
				file.indexStatus === "added" ? "untracked" : (file.indexStatus as "modified" | "deleted"),
			indexStatus: null,
		},
	];
}

function handleStageAll() {
	stagedFiles = [
		...stagedFiles,
		...unstagedFiles.map((f) => ({
			...f,
			indexStatus: (f.worktreeStatus === "untracked"
				? "added"
				: f.worktreeStatus) as GitStatusFile["indexStatus"],
			worktreeStatus: null,
		})),
	];
	unstagedFiles = [];
}

function handleDiscard(path: string) {
	unstagedFiles = unstagedFiles.filter((f) => f.path !== path);
}

function handleCommit(message: string) {
	if (stagedFiles.length === 0 || !message.trim()) return;
	logEntries = [
		{
			sha: Math.random().toString(16).slice(2, 18),
			shortSha: Math.random().toString(16).slice(2, 9),
			message: message.trim(),
			author: "You",
			date: "just now",
		},
		...logEntries,
	];
	stagedFiles = [];
	commitMessage = "";
	remoteStatus = { ...remoteStatus, ahead: remoteStatus.ahead + 1 };
}
</script>

<GitPanelLayout
	branch="feat/jwt-auth"
	iconBasePath={ICON_BASE_PATH}
	{stagedFiles}
	{unstagedFiles}
	{remoteStatus}
	{commitMessage}
	{stashEntries}
	{logEntries}
	{activeView}
	onStage={handleStage}
	onUnstage={handleUnstage}
	onStageAll={handleStageAll}
	onDiscard={handleDiscard}
	onCommitMessageChange={(msg) => (commitMessage = msg)}
	onCommit={handleCommit}
	onPush={() => { remoteStatus = { ...remoteStatus, ahead: 0 }; }}
	onPull={() => { remoteStatus = { ...remoteStatus, behind: 0 }; }}
	onFetch={() => {}}
	onViewChange={(view) => (activeView = view)}
	onStashPop={(idx) => { stashEntries = stashEntries.filter((e) => e.index !== idx); }}
	onStashDrop={(idx) => { stashEntries = stashEntries.filter((e) => e.index !== idx); }}
/>
