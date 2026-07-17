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
		onExternalLinkClick,
		onFilePathClick,
		linkedPrNumber,
		onTogglePrLink,
	}: Props = $props();

	const document = $derived(parseNativeMarkdown(markdown));
</script>

<div class="markdown-content {className}" data-native-markdown-mode={mode}>
	<div class="native-markdown-content">
		{#each document.blocks as block (block.key)}
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
