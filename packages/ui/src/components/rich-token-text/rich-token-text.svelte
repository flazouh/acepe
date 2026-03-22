<script lang="ts">
	import type { InlineArtefactTokenType } from "../../lib/inline-artefact/index.js";
	import { tokenizeInlineArtefacts } from "../../lib/inline-artefact/index.js";
	import { InlineArtefactBadge } from "../inline-artefact-badge/index.js";

	interface Props {
		text: string;
		onTokenClick?: (tokenType: InlineArtefactTokenType, value: string) => void;
		class?: string;
	}

	let { text, onTokenClick, class: className = "" }: Props = $props();

	const segments = $derived(tokenizeInlineArtefacts(text));
</script>

<span class="text-sm leading-relaxed break-words {className}">
	{#each segments as segment, i (i)}
		{#if segment.kind === "text"}
			<span class="whitespace-pre-wrap">{segment.text}</span>
		{:else}
			<InlineArtefactBadge
				tokenType={segment.tokenType}
				label={segment.label}
				value={segment.value}
				charCount={segment.charCount}
				tooltip={segment.title}
				onclick={onTokenClick
					? (e) => {
							e.stopPropagation();
							onTokenClick(segment.tokenType, segment.value);
						}
					: undefined}
			/>
		{/if}
	{/each}
</span>
