<script lang="ts">
import type { StreamingInlineLeaf } from "./logic/build-live-streaming-section-view.js";

interface Props {
	leaf: StreamingInlineLeaf;
}

let { leaf }: Props = $props();
</script>

{#if leaf.kind === "text"}
	{#each leaf.tokens as token (token.key)}
		{#if token.animate}
			<span class="sd-word-fade">{token.text}</span>
		{:else}
			{token.text}
		{/if}
	{/each}
{:else if leaf.kind === "code"}
	{#if leaf.animate}
		<span class="sd-word-fade"><code>{leaf.text}</code></span>
	{:else}
		<code>{leaf.text}</code>
	{/if}
{:else if leaf.kind === "strong"}
	{#if leaf.animate}
		<span class="sd-word-fade"><strong>{leaf.text}</strong></span>
	{:else}
		<strong>{leaf.text}</strong>
	{/if}
{:else if leaf.kind === "em"}
	{#if leaf.animate}
		<span class="sd-word-fade"><em>{leaf.text}</em></span>
	{:else}
		<em>{leaf.text}</em>
	{/if}
{:else}
	{#if leaf.animate}
		<span class="sd-word-fade">
			<span class="streaming-live-link is-disabled" data-streaming-link-state="disabled"
				>{leaf.text}</span
			>
		</span>
	{:else}
		<span class="streaming-live-link is-disabled" data-streaming-link-state="disabled"
			>{leaf.text}</span
		>
	{/if}
{/if}
