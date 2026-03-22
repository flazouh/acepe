<script lang="ts">
	import BlogPostLayout from '$lib/blog/blog-post-layout.svelte';
	import Card from '$lib/components/ui/card/card.svelte';
	import { MarkdownDisplay } from '@acepe/ui';
	import GitCommitDemo from '$lib/blog/demos/git-commit-demo.svelte';
	import GitPrDemo from '$lib/blog/demos/git-pr-demo.svelte';

	let { data } = $props();

	const metadata = {
		title: 'Git Viewer: Beautiful Inline Diffs for Commits and PRs',
		description:
			"Acepe's git viewer lets you browse commits and pull requests with a compact file tree, syntax-highlighted diffs, and inline stats — without leaving your agent session.",
		date: '2026-02-24',
		slug: 'git-viewer',
		readingTimeMinutes: 5,
		category: 'Features'
	};
</script>

<BlogPostLayout
	{metadata}
	showDownload={data.featureFlags.downloadEnabled}
	showLogin={data.featureFlags.loginEnabled}
>
	<MarkdownDisplay
		content={`
# Inline Git Viewer

When an AI agent references a commit or pull request, you shouldn't have to switch to GitHub to see what changed. Acepe's git viewer renders commits and PRs inline with a compact file tree, diff stats, and syntax-highlighted diffs.

## Commit Viewer

Click any commit SHA in an agent's response to open the viewer. You get the full picture at a glance:

- **Compact header** — SHA, message, author, date, and total diff stats
- **File tree** — directories auto-collapse, each file shows +/- counts
- **Inline diffs** — color-coded additions and deletions

Here's what it looks like:
	`}
	/>

	<Card class="mx-auto max-w-4xl">
		<GitCommitDemo />
	</Card>

	<MarkdownDisplay
		content={`
## Pull Request Viewer

PR references work the same way. The header shows the PR number, title, state badge (open, merged, closed), and author:
	`}
	/>

	<Card class="mx-auto max-w-4xl">
		<GitPrDemo />
	</Card>

	<MarkdownDisplay
		content={`
## Design Principles

### Compact by Default, Expandable on Demand

The header shows the essential info in a single row. Click the chevron to expand author, date, and full message body. This keeps the interface tight while giving you access to everything.

### File Tree with Directory Grouping

Files are organized in a proper tree structure, not a flat list. Single-child directory chains are compacted (e.g., \`src/lib/collaboration\` instead of nested folders). Each file shows its status icon:

- Green **+** for added files
- Red **x** for deleted files
- Arrow for renamed files
- Default icon for modified files

### Reusable Components

Every component in the git viewer is a "dumb" presentational component in the \`@acepe/ui\` package. They accept data via props and render it — no API calls, no framework coupling. This means:

- **\`GitCommitHeader\`** — commit metadata card with DiffPill
- **\`GitPrHeader\`** — PR metadata with state badges
- **\`GitFileTree\`** — collapsible file tree with diff stats
- **\`GitDiffViewToggle\`** — inline/split mode switcher
- **\`GitViewer\`** — composed layout that wires everything together

The diff rendering itself is provided via a Svelte snippet, so consumers can plug in their own renderer (we use \`@pierre/diffs\` for syntax highlighting in the desktop app).

## Try It

[Download Acepe](https://acepe.dev/download) and click any commit SHA or PR reference in an agent conversation to see the viewer in action.

---

**Next:** Learn about [checkpoints](/blog/checkpoints) for time-travel debugging during agent sessions.
	`}
	/>
</BlogPostLayout>
