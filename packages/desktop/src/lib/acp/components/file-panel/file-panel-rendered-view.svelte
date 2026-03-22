<script lang="ts">
import MarkdownText from "../messages/markdown-text.svelte";
import type { FilePanelFormatKind } from "./file-panel-format.js";

interface Props {
	content: string;
	projectPath: string;
	formatKind: FilePanelFormatKind;
}

let { content, projectPath, formatKind }: Props = $props();

const lines = $derived(content.split(/\r?\n/));

function getLineClass(line: string): string {
	if (formatKind === "diff") {
		if (line.startsWith("+")) return "line-add";
		if (line.startsWith("-")) return "line-remove";
		if (line.startsWith("@@")) return "line-hunk";
		return "line-normal";
	}

	if (formatKind === "log") {
		const upper = line.toUpperCase();
		if (upper.includes("ERROR") || upper.includes("FATAL")) return "line-error";
		if (upper.includes("WARN")) return "line-warn";
		if (upper.includes("INFO")) return "line-info";
		if (upper.includes("DEBUG") || upper.includes("TRACE")) return "line-debug";
		return "line-normal";
	}

	if (formatKind === "gitignore") {
		if (line.trim().startsWith("#")) return "line-comment";
		if (line.trim().startsWith("!")) return "line-info";
		return "line-normal";
	}

	return "line-normal";
}
</script>

{#if formatKind === "pdf"}
	<object data={content} type="application/pdf" class="pdf-preview" title="PDF preview">
		<p>PDF preview not available</p>
	</object>
{:else if formatKind === "image"}
	<div class="image-preview">
		<img src={content} alt="Preview" />
	</div>
{:else if formatKind === "markdown" || formatKind === "mdx"}
	<MarkdownText text={content} {projectPath} />
{:else if formatKind === "html"}
	<iframe title="HTML preview" class="html-preview" sandbox="allow-same-origin" srcdoc={content}
	></iframe>
{:else}
	<div class="rendered-text">
		{#each lines as line, i (`line-${i}`)}
			<div class={`rendered-line ${getLineClass(line)}`}>{line || " "}</div>
		{/each}
	</div>
{/if}

<style>
	.pdf-preview {
		width: 100%;
		height: 100%;
		min-height: 500px;
		border: none;
	}

	.image-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 200px;
		padding: 1rem;
	}

	.image-preview img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.html-preview {
		width: 100%;
		height: 100%;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: white;
	}

	.rendered-text {
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		font-size: 0.8125rem;
		line-height: 1.5;
		border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
		border-radius: 0.5rem;
		overflow: auto;
		background: color-mix(in srgb, var(--background) 94%, transparent);
	}

	.rendered-line {
		padding: 0.12rem 0.6rem;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.line-add {
		background: color-mix(in srgb, #22c55e 14%, transparent);
		color: color-mix(in srgb, #166534 70%, var(--foreground));
	}

	.line-remove {
		background: color-mix(in srgb, #ef4444 14%, transparent);
		color: color-mix(in srgb, #991b1b 70%, var(--foreground));
	}

	.line-hunk {
		background: color-mix(in srgb, #3b82f6 14%, transparent);
		color: color-mix(in srgb, #1d4ed8 70%, var(--foreground));
	}

	.line-error {
		background: color-mix(in srgb, #ef4444 14%, transparent);
	}

	.line-warn {
		background: color-mix(in srgb, #f59e0b 14%, transparent);
	}

	.line-info {
		background: color-mix(in srgb, #3b82f6 10%, transparent);
	}

	.line-debug {
		background: color-mix(in srgb, var(--muted) 40%, transparent);
	}

	.line-comment {
		color: var(--muted-foreground);
		font-style: italic;
	}
</style>
