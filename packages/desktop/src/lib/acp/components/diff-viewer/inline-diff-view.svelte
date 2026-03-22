<script lang="ts">
import type { FileDiff } from "../../types/github-integration.js";

interface Props {
	diff: FileDiff;
}

let { diff }: Props = $props();

interface DiffLine {
	type: "context" | "addition" | "deletion" | "header";
	content: string;
	lineNumber?: number;
}

function parseDiff(patch: string): DiffLine[] {
	const lines = patch.split("\n");
	const result: DiffLine[] = [];
	let lineNum = 0;

	for (const line of lines) {
		if (line.startsWith("@@")) {
			result.push({ type: "header", content: line });
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			result.push({ type: "addition", content: line.slice(1), lineNumber: lineNum++ });
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			result.push({ type: "deletion", content: line.slice(1), lineNumber: lineNum++ });
		} else {
			result.push({ type: "context", content: line.slice(1), lineNumber: lineNum++ });
		}
	}

	return result;
}

const parsedLines = $derived(parseDiff(diff.patch));
</script>

<div class="inline-diff-view">
	<table class="diff-table">
		<tbody>
			{#each parsedLines as line, idx (idx)}
				<tr class={`line-${line.type}`}>
					<td class="line-number">{line.lineNumber || ""}</td>
					<td class="line-marker">
						{#if line.type === "addition"}
							+
						{:else if line.type === "deletion"}
							−
						{:else if line.type === "header"}
							@@
						{/if}
					</td>
					<td class="line-content">
						{#if line.type === "header"}
							<span class="hunk-header">{line.content}</span>
						{:else}
							<code>{line.content}</code>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.inline-diff-view {
		flex: 1;
		overflow: auto;
		background-color: var(--background);
	}

	.diff-table {
		width: 100%;
		border-collapse: collapse;
		font-family: ui-monospace, "SF Mono", Monaco, monospace;
		font-size: 12px;
		line-height: 1.5;
	}

	tr {
		border-bottom: 1px solid var(--border);
	}

	td {
		padding: 0 8px;
		height: 24px;
		vertical-align: middle;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.line-number {
		width: 40px;
		text-align: right;
		color: var(--muted-foreground);
		background-color: var(--muted);
		border-right: 1px solid var(--border);
		flex-shrink: 0;
		user-select: none;
	}

	.line-marker {
		width: 24px;
		text-align: center;
		color: var(--muted-foreground);
		background-color: var(--muted);
		border-right: 1px solid var(--border);
		flex-shrink: 0;
		user-select: none;
	}

	.line-content {
		padding-left: 12px;
		color: var(--foreground);
	}

	code {
		background: transparent;
		padding: 0;
		font-size: inherit;
		color: inherit;
	}

	.line-addition {
		background-color: rgba(63, 185, 80, 0.1);
	}

	.line-addition .line-marker {
		color: #3fb950;
		background-color: rgba(63, 185, 80, 0.2);
	}

	.line-deletion {
		background-color: rgba(248, 81, 73, 0.1);
	}

	.line-deletion .line-marker {
		color: #f85149;
		background-color: rgba(248, 81, 73, 0.2);
	}

	.line-header {
		background-color: rgba(88, 166, 255, 0.1);
	}

	.line-header .line-marker,
	.line-header .line-number {
		background-color: rgba(88, 166, 255, 0.2);
		color: #58a6ff;
	}

	.hunk-header {
		color: #58a6ff;
		font-weight: 600;
	}

	.line-context {
		background-color: var(--background);
	}
</style>
