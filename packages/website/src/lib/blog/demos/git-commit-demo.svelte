<script lang="ts">
/**
 * Demo: Git Commit Viewer
 * Shows the GitViewer component with mock commit data.
 */
import { GitViewer, type GitCommitData, type GitViewerFile } from "@acepe/ui";

const commit: GitCommitData = {
	sha: "9e39f1a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8",
	shortSha: "9e39f1a",
	message: "feat: add real-time collaboration cursors",
	messageBody:
		"Implements multiplayer cursor presence using WebSocket channels.\nEach user gets a unique color and their cursor position broadcasts to all connected peers.",
	author: "Alice Chen",
	authorEmail: "alice@example.com",
	date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
	files: [
		{
			path: "src/lib/collaboration/cursor-manager.ts",
			status: "added",
			additions: 87,
			deletions: 0,
		},
		{
			path: "src/lib/collaboration/presence-channel.ts",
			status: "added",
			additions: 54,
			deletions: 0,
		},
		{ path: "src/lib/collaboration/types.ts", status: "added", additions: 23, deletions: 0 },
		{ path: "src/lib/editor/editor-view.svelte", status: "modified", additions: 18, deletions: 4 },
		{ path: "src/lib/editor/cursor-overlay.svelte", status: "added", additions: 42, deletions: 0 },
		{ path: "src/lib/services/websocket.ts", status: "modified", additions: 12, deletions: 3 },
		{ path: "package.json", status: "modified", additions: 2, deletions: 1 },
	],
	githubUrl: "https://github.com/example/project/commit/9e39f1a",
};

const MOCK_DIFFS: Record<string, string> = {
	"src/lib/collaboration/cursor-manager.ts": [
		'  import type { CursorPosition, UserPresence } from "./types.js";',
		'  import { presenceChannel } from "./presence-channel.js";',
		"",
		"+ export class CursorManager {",
		"+   private cursors = new Map<string, CursorPosition>();",
		'+   private colors = ["#f97316", "#8b5cf6", "#06b6d4", "#22c55e"];',
		"+",
		"+   addCursor(userId: string, position: CursorPosition): void {",
		"+     this.cursors.set(userId, position);",
		"+     this.broadcastPosition(userId, position);",
		"+   }",
		"+",
		"+   removeCursor(userId: string): void {",
		"+     this.cursors.delete(userId);",
		"+   }",
		"+",
		"+   private broadcastPosition(userId: string, pos: CursorPosition): void {",
		'+     presenceChannel.broadcast("cursor:move", { userId, ...pos });',
		"+   }",
		"+ }",
	].join("\n"),
	"src/lib/editor/editor-view.svelte": [
		'    import { onMount, onDestroy } from "svelte";',
		'+   import { CursorManager } from "../collaboration/cursor-manager.js";',
		'+   import CursorOverlay from "./cursor-overlay.svelte";',
		"",
		"    let editorRef: HTMLDivElement;",
		"+   const cursorManager = new CursorManager();",
		"",
		"    onMount(() => {",
		"-     // TODO: add collaboration support",
		"+     cursorManager.connect(editorRef);",
		"    });",
		"",
		"    onDestroy(() => {",
		"+     cursorManager.disconnect();",
		"    });",
	].join("\n"),
};

let selectedFile = $state(commit.files[0].path);
let viewMode = $state<"inline" | "side-by-side">("inline");
</script>

<p class="demo-hint">
	Interactive demo — click files in the sidebar to see their diffs, toggle between inline and split view.
</p>

<div class="viewer-wrapper">
		<GitViewer
			data={{ type: 'commit', commit }}
			{selectedFile}
			{viewMode}
			onSelectFile={(path) => (selectedFile = path)}
			onChangeViewMode={(mode) => (viewMode = mode)}
		>
			{#snippet diffContent({ file })}
				{@const mockDiff = MOCK_DIFFS[file.path]}
				{#if mockDiff}
					<div class="mock-diff">
						{#each mockDiff.split('\n') as line, i (i)}
							<div
								class="diff-line"
								class:line-add={line.startsWith('+')}
								class:line-del={line.startsWith('-')}
								class:line-ctx={!line.startsWith('+') && !line.startsWith('-')}
							>
								<span class="line-marker">
									{#if line.startsWith('+')}<span class="text-success">+</span>
									{:else if line.startsWith('-')}<span class="text-destructive">-</span>
									{:else}<span>&nbsp;</span>{/if}
								</span>
								<code>{line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}</code>
							</div>
						{/each}
					</div>
				{:else}
					<div class="no-diff">
						<p class="text-muted-foreground text-sm">Diff preview not available for this file</p>
					</div>
				{/if}
			{/snippet}
		</GitViewer>
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

	.viewer-wrapper {
		height: 420px;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border) / 0.3);
		overflow: hidden;
	}

	.mock-diff {
		font-family: ui-monospace, 'SF Mono', Monaco, monospace;
		font-size: 12px;
		line-height: 1.6;
		padding: 8px 0;
	}

	.diff-line {
		display: flex;
		padding: 0 12px;
	}

	.line-marker {
		width: 20px;
		flex-shrink: 0;
		text-align: center;
		user-select: none;
	}

	.line-add {
		background: hsl(var(--success) / 0.08);
	}

	.line-del {
		background: hsl(var(--destructive) / 0.08);
	}

	code {
		background: transparent;
		padding: 0;
		color: inherit;
		font-size: inherit;
	}

	.no-diff {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 2rem;
	}
</style>
