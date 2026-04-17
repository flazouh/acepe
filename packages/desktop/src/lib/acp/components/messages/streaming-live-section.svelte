<script lang="ts">
import type { StreamingTailSection } from "./logic/parse-streaming-tail.js";
import {
	buildLiveStreamingSectionView,
	type LiveStreamingSectionView,
} from "./logic/build-live-streaming-section-view.js";
import StreamingInlineLeaf from "./streaming-inline-leaf.svelte";

interface Props {
	section: Extract<
		StreamingTailSection,
		{ kind: "settled" | "live-text" | "live-markdown" | "live-code" }
	>;
	animate?: boolean;
}

let { section, animate = false }: Props = $props();

const view = $derived(
	buildLiveStreamingSectionView(section, { animate: section.kind === "settled" ? false : animate })
);

function headingTag(level: number): "h1" | "h2" | "h3" | "h4" | "h5" | "h6" {
	if (level <= 1) return "h1";
	if (level === 2) return "h2";
	if (level === 3) return "h3";
	if (level === 4) return "h4";
	if (level === 5) return "h5";
	return "h6";
}
</script>

{#if view.kind === "plain-text"}
	<div class="streaming-live-text whitespace-pre-wrap">
		{#each view.tokens as token (token.key)}
			{#if token.animate}
				<span class="sd-word-fade">{token.text}</span>
			{:else}
				{token.text}
			{/if}
		{/each}
	</div>
{:else if view.kind === "code"}
	<div class:sd-word-fade={view.animate} class="streaming-live-code-shell">
		<pre class="streaming-live-code"><code>{view.code}</code></pre>
	</div>
{:else if view.kind === "heading"}
	<svelte:element this={headingTag(view.level)}>
		{#each view.leaves as leaf (leaf.key)}
			<StreamingInlineLeaf {leaf} />
		{/each}
	</svelte:element>
{:else if view.kind === "blockquote"}
	<blockquote>
		<p>
			{#each view.lines as line, index (line.key)}
				{#each line.leaves as leaf (leaf.key)}
					<StreamingInlineLeaf {leaf} />
				{/each}
				{#if index < view.lines.length - 1}
					<br />
				{/if}
			{/each}
		</p>
	</blockquote>
{:else if view.kind === "list"}
	<svelte:element
		this={view.ordered ? "ol" : "ul"}
		start={view.start === null ? undefined : view.start}
	>
		{#each view.items as item (item.key)}
			<li>
				{#each item.leaves as leaf (leaf.key)}
					<StreamingInlineLeaf {leaf} />
				{/each}
			</li>
		{/each}
	</svelte:element>
{:else}
	<p>
		{#each view.leaves as leaf (leaf.key)}
			<StreamingInlineLeaf {leaf} />
		{/each}
	</p>
{/if}
