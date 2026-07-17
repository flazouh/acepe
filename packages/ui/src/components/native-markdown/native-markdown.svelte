<script lang="ts">
	import NativeMarkdownBlock from "./native-markdown-block.svelte";
	import { parseNativeMarkdown } from "./native-markdown-model.js";
	import type {
		NativeMarkdownAnimation,
		NativeMarkdownMode,
		TogglePrLinkPayload,
	} from "./types.js";
	import "../markdown/markdown-prose.css";

	interface Props {
		markdown: string;
		class?: string;
		mode?: NativeMarkdownMode;
		parseIncompleteMarkdown?: boolean;
		animated?: NativeMarkdownAnimation;
		/**
		 * Mount-driven reveal animation for streaming text. `"word"` fades each
		 * inline word as it first appears; `"block"` fades each top-level block.
		 * Both are opacity-only and purely CSS (see markdown-prose.css) — an
		 * element animates once when it mounts, so with stable keys only newly
		 * revealed words/blocks animate, not the whole re-rendered tree. Default
		 * `"none"` leaves rendering unchanged. Pair with a text source that grows
		 * over time (e.g. a presentation-buffer drip) for a streaming reveal.
		 */
		reveal?: "none" | "word" | "block";
		onExternalLinkClick?: (url: string) => void;
		onFilePathClick?: (filePath: string) => void;
		/** PR number this chat is currently linked to, for chip link/unlink state. */
		linkedPrNumber?: number | null;
		/** Emitted when the user clicks the link/unlink control on a PR chip. */
		onTogglePrLink?: (payload: TogglePrLinkPayload) => void;
	}

	let {
		markdown,
		class: className = "",
		mode = "static",
		parseIncompleteMarkdown: _parseIncompleteMarkdown,
		animated: _animated,
		reveal = "none",
		onExternalLinkClick,
		onFilePathClick,
		linkedPrNumber,
		onTogglePrLink,
	}: Props = $props();

	const document = $derived(parseNativeMarkdown(markdown));
</script>

<div
	class="markdown-content {className}"
	data-native-markdown-mode={mode}
	data-reveal={reveal === "none" ? undefined : reveal}
>
		<!--
		Keyed by position, not block.key: a streaming document only ever appends
		or grows its last block, and block.key comes from the global nextKey
		counter, which shifts when an earlier/in-progress block gains content —
		remounting the tail block and restarting its reveal fade (block-fade
		flicker). Index keys keep each block's identity stable as it streams in,
		so a block reconciles in place and only genuinely new blocks fade.
		-->
	<div class="native-markdown-content">
		{#each document.blocks as block, blockIndex (blockIndex)}
			<NativeMarkdownBlock
				{block}
				wordCount={document.wordCount}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</div>
</div>
