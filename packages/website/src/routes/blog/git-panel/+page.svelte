<script lang="ts">
import BlogPostLayout from "$lib/blog/blog-post-layout.svelte";
import { gitPanelBlogPost as metadata } from "$lib/blog/posts.js";
import Card from "$lib/components/ui/card/card.svelte";
import { MarkdownDisplay } from "@acepe/ui";
import GitPanelDemo from "$lib/blog/demos/git-panel-demo.svelte";
import {
	GitBranchBadge,
	GitRemoteStatusBadge,
	GitCommitBox,
	GitStatusList,
	GitLogList,
	GitStashList,
	type GitStatusFile,
	type GitLogEntry,
	type GitStashEntry,
	type GitRemoteStatus,
} from "@acepe/ui/git-panel";

let { data } = $props();

// --- Demo state for individual components ---

let commitMessage = $state("");
let commitCommitted = $state(false);

const demoStagedFiles: GitStatusFile[] = [
	{
		path: "src/lib/auth/session.ts",
		indexStatus: "modified",
		worktreeStatus: null,
		additions: 12,
		deletions: 3,
	},
	{
		path: "src/lib/auth/token.ts",
		indexStatus: "added",
		worktreeStatus: null,
		additions: 45,
		deletions: 0,
	},
];

const demoUnstagedFiles: GitStatusFile[] = [
	{
		path: "src/lib/api/client.ts",
		indexStatus: null,
		worktreeStatus: "modified",
		additions: 8,
		deletions: 2,
	},
	{
		path: "tests/auth.test.ts",
		indexStatus: null,
		worktreeStatus: "untracked",
		additions: 30,
		deletions: 0,
	},
	{
		path: "old-config.json",
		indexStatus: null,
		worktreeStatus: "deleted",
		additions: 0,
		deletions: 15,
	},
];

const demoRemoteStatus: GitRemoteStatus = {
	ahead: 3,
	behind: 1,
	remote: "origin",
	trackingBranch: "origin/feat/auth",
};

const demoLogEntries: GitLogEntry[] = [
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
		message: "chore: update dependencies",
		author: "CI Bot",
		date: "2d ago",
	},
];

const demoStashEntries: GitStashEntry[] = [
	{ index: 0, message: "WIP on feat/auth: token refresh logic", date: "3h ago" },
	{ index: 1, message: "save: experiment with OAuth flow", date: "1d ago" },
];
</script>

<BlogPostLayout
	{metadata}
	showDownload={data.featureFlags.downloadEnabled}
	showLogin={data.featureFlags.loginEnabled}
>
	<MarkdownDisplay
		content={`
# Git Panel

Most AI coding tools treat git as an afterthought — you still need a terminal or a separate app to stage, commit, and push. Acepe's Git Panel brings the full git workflow into a dedicated panel, so you never leave context.

## Full Interactive Demo

Stage files, write a commit message, and commit. Switch tabs to browse history or stash.
	`}
	/>

	<Card class="mx-auto max-w-[480px]">
		<GitPanelDemo />
	</Card>

	<MarkdownDisplay
		content={`
## Components

Every piece of the git panel is a standalone component — here's each one in action.

### Branch Badge

Shows the current branch with a git icon. Compact and monospaced.
	`}
	/>

	<Card class="mx-auto max-w-[480px]">
		<div class="flex flex-wrap items-center gap-3">
			<GitBranchBadge branch="main" />
			<GitBranchBadge branch="feat/authentication" />
			<GitBranchBadge branch="fix/memory-leak" />
		</div>
	</Card>

	<MarkdownDisplay
		content={`
### Remote Status

Ahead/behind indicator — shows how your local branch compares to the remote.
	`}
	/>

	<Card class="mx-auto max-w-[480px]">
		<div class="flex flex-wrap items-center gap-4">
			<div class="flex items-center gap-2">
				<span class="text-[0.8125rem] text-muted-foreground">3 ahead, 1 behind:</span>
				<GitRemoteStatusBadge status={demoRemoteStatus} />
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[0.8125rem] text-muted-foreground">2 ahead:</span>
				<GitRemoteStatusBadge status={{ ahead: 2, behind: 0, remote: 'origin', trackingBranch: 'origin/main' }} />
			</div>
			<div class="flex items-center gap-2">
				<span class="text-[0.8125rem] text-muted-foreground">5 behind:</span>
				<GitRemoteStatusBadge status={{ ahead: 0, behind: 5, remote: 'origin', trackingBranch: 'origin/main' }} />
			</div>
		</div>
	</Card>

	<MarkdownDisplay
		content={`
### File Status List

Staged and unstaged files in collapsible sections. Each file shows its status icon, diff stats, and hover actions for staging/unstaging/discarding.
	`}
	/>

	<Card class="mx-auto max-w-[480px] max-h-[280px] overflow-y-auto">
		<GitStatusList
			stagedFiles={demoStagedFiles}
			unstagedFiles={demoUnstagedFiles}
		/>
	</Card>

	<MarkdownDisplay
		content={`
### Commit Box

Write a commit message and hit Commit (or \`Cmd+Enter\`). The button disables when the message is empty.
	`}
	/>

	<Card class="mx-auto max-w-[480px]">
		{#if commitCommitted}
			<p class="py-4 text-center text-sm text-success">
				Committed!
				<button
					class="text-primary underline cursor-pointer bg-transparent border-0 text-inherit"
					onclick={() => { commitCommitted = false; commitMessage = ''; }}
				>
					Reset demo
				</button>
			</p>
		{:else}
			<GitCommitBox
				message={commitMessage}
				onMessageChange={(msg: string) => (commitMessage = msg)}
				onCommit={() => { commitCommitted = true; }}
			/>
		{/if}
	</Card>

	<MarkdownDisplay
		content={`
### Commit History

Browse recent commits — each row shows the SHA, message, author, and relative date.
	`}
	/>

	<Card class="mx-auto max-w-[480px] max-h-[280px] overflow-y-auto">
		<GitLogList entries={demoLogEntries} />
	</Card>

	<MarkdownDisplay
		content={`
### Stash List

View stashed changes with pop and drop actions on hover.
	`}
	/>

	<Card class="mx-auto max-w-[480px] max-h-[280px] overflow-y-auto">
		<GitStashList
			entries={demoStashEntries}
			onPop={() => {}}
			onDrop={() => {}}
		/>
	</Card>

	<MarkdownDisplay
		content={`
## How It Works

The panel opens from the sidebar for any project. Every component is presentational — props in, callbacks out. The desktop app wires them to Tauri commands that run real git operations in Rust. This blog page uses the same components with mock data.

- **Stage / Unstage** — click the \`+\` or \`−\` icon on any file
- **Commit** — write a message and press Commit or \`Cmd+Enter\`
- **Push / Pull / Fetch** — remote operations in the header bar
- **History** — browse recent commits in the History tab
- **Stash** — view, pop, or drop stashed changes

---

**Related:** See how the [Git Viewer](/blog/git-viewer) renders inline diffs for commits and PRs.
	`}
	/>
</BlogPostLayout>
