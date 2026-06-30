<script lang="ts">
	import NativeMarkdownBlock from "./native-markdown-block.svelte";
	import { parseNativeMarkdown } from "./native-markdown-model.js";
	import type {
		NativeMarkdownAnimation,
		NativeMarkdownMode,
		NativeMarkdownTokenRevealTiming,
		TogglePrLinkPayload,
	} from "./types.js";
	import "../markdown/markdown-prose.css";

	interface Props {
		markdown: string;
		class?: string;
		mode?: NativeMarkdownMode;
		parseIncompleteMarkdown?: boolean;
		animated?: NativeMarkdownAnimation;
		tokenRevealTiming?: NativeMarkdownTokenRevealTiming;
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
		tokenRevealTiming,
		onExternalLinkClick,
		onFilePathClick,
		linkedPrNumber,
		onTogglePrLink,
	}: Props = $props();

	const document = $derived(parseNativeMarkdown(markdown));
	const activeTokenRevealTiming = $derived(
		tokenRevealTiming !== undefined &&
			tokenRevealTiming.mode === "smooth" &&
			tokenRevealTiming.revealCount > 0
			? tokenRevealTiming
			: undefined,
	);
	const tokenRevealStyle = $derived(
		activeTokenRevealTiming === undefined
			? undefined
			: [
					`--token-reveal-baseline-ms: ${String(activeTokenRevealTiming.baselineMs)}ms`,
					`--token-reveal-step-ms: ${String(activeTokenRevealTiming.tokStepMs)}ms`,
					`--token-reveal-fade-ms: ${String(activeTokenRevealTiming.tokFadeDurMs)}ms`,
				].join("; "),
	);
	const tokenRevealMode = $derived(activeTokenRevealTiming?.mode);
</script>

<div
	class="markdown-content {className}"
	style={tokenRevealStyle}
	data-token-reveal-mode={tokenRevealMode}
	data-native-markdown-mode={mode}
>
	<div class="native-markdown-content">
		{#each document.blocks as block (block.key)}
			<NativeMarkdownBlock
				{block}
				wordCount={document.wordCount}
				tokenRevealTiming={activeTokenRevealTiming}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</div>
</div>
