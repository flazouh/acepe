<script lang="ts">
interface CodeBlockProps {
	/**
	 * The content to display in the code block.
	 */
	content: string;

	/**
	 * Optional CSS class name to add to the code block.
	 */
	class?: string;

	/**
	 * Whether to show line numbers.
	 */
	showLineNumbers?: boolean;

	/**
	 * Optional highlighted HTML content (takes precedence over content).
	 */
	highlightedHtml?: string;
}

let {
	content,
	class: className,
	showLineNumbers = false,
	highlightedHtml,
}: CodeBlockProps = $props();

// Split content into lines for line numbers
const lines = $derived.by(() => {
	if (!showLineNumbers) return [];
	return content.split("\n");
});

// Parse highlighted HTML and split into lines
const highlightedLines = $derived.by(() => {
	if (!showLineNumbers || !highlightedHtml) return [];

	// Split the highlighted HTML by newlines while preserving HTML structure
	// This is a simple split - assumes the HTML uses <span> tags for syntax highlighting
	const tempDiv = document.createElement("div");
	tempDiv.innerHTML = highlightedHtml;

	// Split the HTML by <br> or newlines in text
	const htmlLines: string[] = [];
	let currentLine = "";
	let inTag = false;

	for (let i = 0; i < highlightedHtml.length; i++) {
		const char = highlightedHtml[i];

		if (char === "<") {
			inTag = true;
			currentLine += char;
		} else if (char === ">") {
			inTag = false;
			currentLine += char;
		} else if (char === "\n" && !inTag) {
			htmlLines.push(currentLine);
			currentLine = "";
		} else {
			currentLine += char;
		}
	}

	if (currentLine) {
		htmlLines.push(currentLine);
	}

	return htmlLines;
});
</script>

{#if showLineNumbers}
	<div class="code-block-with-lines {className || ''}">
		<div class="code-content">
			{#if highlightedHtml && highlightedLines.length > 0}
				{#each highlightedLines as line, i (`highlighted-${i}`)}
					<div class="code-line">
						<span class="code-line-number">{i + 1}</span>
						<span class="code-line-content">{@html line || "\u00a0"}</span>
					</div>
				{/each}
			{:else}
				{#each lines as line, i (`plain-${i}`)}
					<div class="code-line">
						<span class="code-line-number">{i + 1}</span>
						<span class="code-line-content">{line || "\u00a0"}</span>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{:else}
	<pre class="code-block {className || ''}">{content}</pre>
{/if}

<style>
	.code-block {
		background-color: color-mix(in srgb, var(--input) 30%, transparent);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		padding: 0.75rem 1rem 0.75rem 0;
		overflow-x: auto;
		margin: 0.5rem 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		white-space: pre-wrap;
		word-break: break-words;
	}

	.code-block-with-lines {
		overflow-x: auto;
		overflow-y: auto;
		min-width: 0;
	}

	.code-content {
		display: inline-block;
		min-width: 100%;
		font-family: "Fira Code", "JetBrains Mono", "Consolas", monospace;
		font-size: 0.75rem;
	}

	.code-line {
		display: block;
		min-width: 100%;
		white-space: pre;
		padding-left: 0.25rem;
		padding-right: 0.5rem;
		line-height: 1.5;
	}

	.code-line-content {
		display: inline;
		white-space: pre;
	}

	.code-line-number {
		display: inline-block;
		width: 2.5rem;
		padding-right: 0.75rem;
		margin-right: 0.5rem;
		text-align: right;
		color: rgba(255, 255, 255, 0.25);
		border-right: 1px solid rgba(255, 255, 255, 0.1);
		user-select: none;
		pointer-events: none;
		flex-shrink: 0;
	}

	.code-highlighted {
		padding-left: 0.25rem;
		padding-right: 0.5rem;
	}

	/* Ensure empty lines have proper height */
	.code-line:empty::after,
	.code-line-content:empty::after {
		content: "\00a0";
	}
</style>
