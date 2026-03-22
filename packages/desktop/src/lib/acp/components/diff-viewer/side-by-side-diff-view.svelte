<script lang="ts">
import type { FileDiff as FileDiffType } from "../../types/github-integration.js";

import { parsePatchToBeforeAfter } from "../../utils/diff-patch-parser.js";

interface Props {
	diff: FileDiffType;
}

let { diff }: Props = $props();

// Parse patch to get before/after content
const parseResult = $derived.by(() => {
	return parsePatchToBeforeAfter(diff.patch, diff.status);
});

// Detect language from filename extension (for future syntax highlighting)
const _language = $derived.by(() => {
	const ext = diff.path.split(".").pop()?.toLowerCase();
	const languageMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		svelte: "svelte",
		rs: "rust",
		py: "python",
		go: "go",
		json: "json",
		css: "css",
		scss: "scss",
		html: "html",
		md: "markdown",
		yml: "yaml",
		yaml: "yaml",
		toml: "toml",
		sql: "sql",
	};
	return languageMap[ext || ""] || undefined;
});

// Determine if file is binary
const isBinary = $derived(parseResult.isErr() && parseResult.error.type === "binary_file");

// Format content for display
const displayContent = $derived.by(() => {
	if (parseResult.isErr()) {
		return { before: "", after: "" };
	}
	return {
		before: parseResult.value.before,
		after: parseResult.value.after,
	};
});
</script>

{#if isBinary}
	<div class="error-message">
		<p>Binary file - cannot display in diff view</p>
	</div>
{:else if diff.status === "deleted"}
	<div class="file-status-view">
		<div class="status-header">File deleted</div>
		<div class="code-display">
			{#if displayContent.before}
				<pre><code>{displayContent.before}</code></pre>
			{:else}
				<p class="empty-file">Empty file</p>
			{/if}
		</div>
	</div>
{:else if diff.status === "added"}
	<div class="file-status-view">
		<div class="status-header">File added</div>
		<div class="code-display">
			{#if displayContent.after}
				<pre><code>{displayContent.after}</code></pre>
			{:else}
				<p class="empty-file">Empty file</p>
			{/if}
		</div>
	</div>
{:else}
	<!-- Normal modified/renamed file - show side-by-side -->
	<div class="side-by-side-wrapper">
		<div class="diff-pane before">
			<div class="pane-header">Before</div>
			<div class="pane-content">
				{#if displayContent.before}
					<pre><code>{displayContent.before}</code></pre>
				{:else}
					<p class="empty-pane">No changes in this section</p>
				{/if}
			</div>
		</div>

		<div class="divider"></div>

		<div class="diff-pane after">
			<div class="pane-header">After</div>
			<div class="pane-content">
				{#if displayContent.after}
					<pre><code>{displayContent.after}</code></pre>
				{:else}
					<p class="empty-pane">No changes in this section</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	:global(.side-by-side-diff-view) {
		flex: 1;
		overflow: auto;
		background-color: var(--background);
		font-family: ui-monospace, "SF Mono", Monaco, monospace;
		font-size: 12px;
	}

	.error-message,
	.file-status-view {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		flex-direction: column;
		color: var(--muted-foreground);
		padding: 24px;
		text-align: center;
	}

	.status-header {
		font-size: 14px;
		font-weight: 600;
		color: var(--foreground);
		margin-bottom: 16px;
	}

	.code-display {
		width: 100%;
		max-width: 100%;
		overflow: auto;
	}

	.side-by-side-wrapper {
		display: grid;
		grid-template-columns: 1fr 1px 1fr;
		height: 100%;
		overflow: hidden;
		gap: 0;
	}

	.diff-pane {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background-color: var(--background);
	}

	.diff-pane.before {
		border-right: 1px solid var(--border);
	}

	.pane-header {
		flex-shrink: 0;
		padding: 8px 12px;
		background-color: var(--muted);
		border-bottom: 1px solid var(--border);
		font-weight: 600;
		color: var(--foreground);
		font-size: 12px;
	}

	.pane-content {
		flex: 1;
		overflow: auto;
		padding: 8px;
	}

	.divider {
		width: 1px;
		background-color: var(--border);
		flex-shrink: 0;
	}

	pre {
		margin: 0;
		background: transparent;
		padding: 0;
		font-size: inherit;
		line-height: 1.5;
		color: var(--foreground);
		white-space: pre-wrap;
		word-break: break-word;
	}

	code {
		font-family: inherit;
		color: inherit;
		background: transparent;
		padding: 0;
	}

	.empty-file,
	.empty-pane {
		color: var(--muted-foreground);
		font-style: italic;
		padding: 24px;
		text-align: center;
		margin: 0;
	}
</style>
