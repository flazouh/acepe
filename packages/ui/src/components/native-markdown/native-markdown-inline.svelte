<script lang="ts">
	import Self from "./native-markdown-inline.svelte";
	import NativeMarkdownFileChip from "./native-markdown-file-chip.svelte";
	import NativeMarkdownGithubChip from "./native-markdown-github-chip.svelte";
	import {
		isExternalUrl,
		isGitHubUrl,
		isLocalFileReference,
		type NativeMarkdownInline,
		type NativeMarkdownWordPart,
	} from "./native-markdown-model.js";
	import type {
		NativeMarkdownTokenRevealTiming,
		TogglePrLinkPayload,
	} from "./types.js";

	interface Props {
		token: NativeMarkdownInline;
		wordCount: number;
		tokenRevealTiming?: NativeMarkdownTokenRevealTiming;
		onExternalLinkClick?: (url: string) => void;
		onFilePathClick?: (filePath: string) => void;
		linkedPrNumber?: number | null;
		onTogglePrLink?: (payload: TogglePrLinkPayload) => void;
	}

	let {
		token,
		wordCount,
		tokenRevealTiming,
		onExternalLinkClick,
		onFilePathClick,
		linkedPrNumber,
		onTogglePrLink,
	}: Props = $props();

	function isAnimatedWord(part: NativeMarkdownWordPart): boolean {
		if (
			tokenRevealTiming === undefined ||
			tokenRevealTiming.mode === "instant" ||
			tokenRevealTiming.revealCount < 1
		) {
			return false;
		}

		return part.wordIndex >= Math.max(0, wordCount - tokenRevealTiming.revealCount);
	}

	function getAnimatedWordStyle(part: NativeMarkdownWordPart): string | undefined {
		if (!isAnimatedWord(part) || tokenRevealTiming === undefined) {
			return undefined;
		}

		const tailStartIndex = Math.max(0, wordCount - tokenRevealTiming.revealCount);
		const tailIndex = Math.max(0, part.wordIndex - tailStartIndex);
		const delayMs = tailIndex * tokenRevealTiming.tokStepMs;
		return [
			"--sd-animation: sd-acepeTokenReveal",
			`--sd-duration: ${String(tokenRevealTiming.tokFadeDurMs)}ms`,
			"--sd-easing: cubic-bezier(0.16, 1, 0.3, 1)",
			`--sd-delay: ${String(delayMs)}ms`,
		].join("; ");
	}

	function handleExternalLinkClick(event: MouseEvent, href: string): void {
		if (onExternalLinkClick === undefined || !isExternalUrl(href)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onExternalLinkClick(href);
	}
</script>

{#if token.type === "text"}
	{#each token.parts as part (part.key)}
		{#if part.type === "space"}
			{part.text}
		{:else}
			{@const animated = isAnimatedWord(part)}
			<span
				data-markdown-token-word={part.text}
				data-sd-animate={animated ? "true" : undefined}
				data-acepe-token-reveal-tail={animated ? "true" : undefined}
				style={getAnimatedWordStyle(part)}
			>{part.text}</span>
		{/if}
	{/each}
{:else if token.type === "code"}
	{#if onFilePathClick !== undefined && isLocalFileReference(token.text)}
		<NativeMarkdownFileChip fileReference={token.text} {onFilePathClick} />
	{:else}
		<code>{token.text}</code>
	{/if}
{:else if token.type === "link"}
	{#if token.href === null}
		{#each token.children as child (child.key)}
			<Self
				token={child}
				{wordCount}
				{tokenRevealTiming}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	{:else if onFilePathClick !== undefined && isLocalFileReference(token.href)}
		<NativeMarkdownFileChip fileReference={token.href} {onFilePathClick} />
	{:else if isGitHubUrl(token.href)}
		<NativeMarkdownGithubChip
			href={token.href}
			fallbackLabel={token.label}
			{linkedPrNumber}
			{onTogglePrLink}
			{onExternalLinkClick}
		/>
	{:else}
		<a
			href={token.href}
			rel={isExternalUrl(token.href) ? "noopener noreferrer" : undefined}
			target={isExternalUrl(token.href) ? "_blank" : undefined}
			onclick={(event) => handleExternalLinkClick(event, token.href ?? "")}
		>
			{#each token.children as child (child.key)}
				<Self
					token={child}
					{wordCount}
					{tokenRevealTiming}
					{onExternalLinkClick}
					{onFilePathClick}
					{linkedPrNumber}
					{onTogglePrLink}
				/>
			{/each}
		</a>
	{/if}
{:else if token.type === "strong"}
	<strong>
		{#each token.children as child (child.key)}
			<Self
				token={child}
				{wordCount}
				{tokenRevealTiming}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</strong>
{:else if token.type === "em"}
	<em>
		{#each token.children as child (child.key)}
			<Self
				token={child}
				{wordCount}
				{tokenRevealTiming}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</em>
{:else if token.type === "delete"}
	<del>
		{#each token.children as child (child.key)}
			<Self
				token={child}
				{wordCount}
				{tokenRevealTiming}
				{onExternalLinkClick}
				{onFilePathClick}
				{linkedPrNumber}
				{onTogglePrLink}
			/>
		{/each}
	</del>
{:else if token.type === "line_break"}
	<br />
{/if}
