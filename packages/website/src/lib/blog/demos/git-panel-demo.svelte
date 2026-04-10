<script lang="ts">
/**
 * Demo: Git Panel — interactive staging, committing, and history.
 * All mock data, no backend needed.
 */
import {
	GitPanelLayout,
	type GitStatusFile,
	type GitStashEntry,
	type GitLogEntry,
	type GitRemoteStatus,
} from "@acepe/ui";

type ViewTab = "status" | "history" | "stash";

// --- Mock data ---

const allFiles: GitStatusFile[] = [
	{
		path: "src/lib/collaboration/cursor-manager.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 18,
		deletions: 4,
	},
	{
		path: "src/lib/collaboration/presence-channel.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 7,
		deletions: 2,
	},
	{
		path: "src/lib/editor/cursor-overlay.svelte",
		indexStatus: null,
		worktreeStatus: "untracked",
		additions: 42,
		deletions: 0,
	},
	{
		path: "src/lib/services/websocket.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 12,
		deletions: 3,
	},
	{
		path: "package.json",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 2,
		deletions: 1,
	},
	{
		path: "old-config.json",
		indexStatus: null,
		worktreeStatus: "deleted",
		additions: 0,
		deletions: 20,
	},
];

let stagedFiles = $state<GitStatusFile[]>([]);
let unstagedFiles = $state<GitStatusFile[]>([...allFiles]);
let commitMessage = $state("");
let activeView = $state<ViewTab>("status");

let remoteStatus = $state<GitRemoteStatus>({
	ahead: 2,
	behind: 0,
	remote: "origin",
	trackingBranch: "origin/feat/collaboration",
});

let stashEntries = $state<GitStashEntry[]>([
	{ index: 0, message: "WIP on feat/collaboration: cursor colors", date: "2h ago" },
	{ index: 1, message: "save: experiment with WebRTC", date: "1d ago" },
]);

let logEntries = $state<GitLogEntry[]>([
	{
		sha: "9e39f1a0b2c4d5e6",
		shortSha: "9e39f1a",
		message: "feat: add real-time collaboration cursors",
		author: "Alice",
		date: "2h ago",
	},
	{
		sha: "7b2c3d4e5f6a7b8c",
		shortSha: "7b2c3d4",
		message: "fix: memory leak in WebSocket reconnect",
		author: "Bob",
		date: "5h ago",
	},
	{
		sha: "a1b2c3d4e5f6a7b8",
		shortSha: "a1b2c3d",
		message: "refactor: extract presence module",
		author: "Alice",
		date: "1d ago",
	},
	{
		sha: "f0e1d2c3b4a5f0e1",
		shortSha: "f0e1d2c",
		message: "chore: update dependencies",
		author: "CI Bot",
		date: "2d ago",
	},
	{
		sha: "c5d6e7f8a9b0c5d6",
		shortSha: "c5d6e7f",
		message: "feat: initial editor scaffolding",
		author: "Alice",
		date: "3d ago",
	},
]);

// --- Handlers ---

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
	const newEntry: GitLogEntry = {
		sha: Math.random().toString(16).slice(2, 18),
		shortSha: Math.random().toString(16).slice(2, 9),
		message: message.trim(),
		author: "You",
		date: "just now",
	};
	logEntries = [newEntry, ...logEntries];
	stagedFiles = [];
	commitMessage = "";
	remoteStatus = { ...remoteStatus, ahead: remoteStatus.ahead + 1 };
}

function handlePush() {
	remoteStatus = { ...remoteStatus, ahead: 0 };
}

function handlePull() {
	remoteStatus = { ...remoteStatus, behind: 0 };
}

function handleFetch() {
	// No-op in demo
}

function handleStashPop(index: number) {
	stashEntries = stashEntries.filter((e) => e.index !== index);
}

function handleStashDrop(index: number) {
	stashEntries = stashEntries.filter((e) => e.index !== index);
}
</script>

<p class="demo-hint">
	Interactive demo — stage files, write a commit message, and commit. Switch tabs to browse
	history or stash.
</p>

<div class="panel-wrapper">
	<GitPanelLayout
			branch="feat/collaboration"
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
			onPush={handlePush}
			onPull={handlePull}
			onFetch={handleFetch}
			onViewChange={(view) => (activeView = view)}
			onStashPop={handleStashPop}
			onStashDrop={handleStashDrop}
		/>
</div>

<style>
	.demo-hint {
		margin-bottom: 1rem;
		padding: 0.75rem;
		border-radius: 0.375rem;
		background: hsl(var(--muted) / 0.5);
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		text-align: center;
	}

	.panel-wrapper {
		height: 520px;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.3);
		overflow: hidden;
	}
</style>
