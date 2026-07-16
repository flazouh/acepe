<script lang="ts">
	import { buildChipShellClassName } from "../chip/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		parseGitHubChipRef,
		type GitHubChipRef,
	} from "./native-markdown-model.js";
	import type { TogglePrLinkPayload } from "./types.js";

	interface Props {
		href: string;
		fallbackLabel: string;
		linkedPrNumber?: number | null;
		onTogglePrLink?: (payload: TogglePrLinkPayload) => void;
		onExternalLinkClick?: (url: string) => void;
	}

	let {
		href,
		fallbackLabel,
		linkedPrNumber,
		onTogglePrLink,
		onExternalLinkClick,
	}: Props = $props();

	const ref = $derived<GitHubChipRef | null>(parseGitHubChipRef(href));
	const label = $derived(ref === null ? fallbackLabel : `${ref.owner}/${ref.repo}#${ref.number}`);
	const isLinked = $derived(ref !== null && linkedPrNumber != null && ref.number === linkedPrNumber);
	const showToggle = $derived(ref !== null && ref.isPullRequest && onTogglePrLink !== undefined);
	const chipClassName = $derived(
		buildChipShellClassName({
			density: "badge",
			interactive: true,
			className: "github-badge",
		}),
	);

	function handleLinkClick(event: MouseEvent): void {
		if (onExternalLinkClick === undefined) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		onExternalLinkClick(href);
	}

	function handleToggleClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		if (ref === null) {
			return;
		}

		onTogglePrLink?.({
			owner: ref.owner,
			repo: ref.repo,
			prNumber: ref.number,
			href,
			isLinked,
		});
	}
</script>

{#snippet chipContent()}
	<span
		class="flex h-3.5 w-3.5 shrink-0 items-center justify-center {isLinked
			? 'text-success'
			: 'text-muted-foreground'}"
		aria-hidden="true"
	>
		<HugeiconsIcon name="pull-request" class="size-3.5" />
	</span>
	<span class="min-w-0 truncate font-mono text-[0.6875rem] leading-none">
		{label}
	</span>
{/snippet}

{#snippet unlinkIcon()}
	<HugeiconsIcon name="x-circle" class="size-3" data-testid="github-chip-unlink-rounded-icon" />
{/snippet}

{#if showToggle}
	<span class={chipClassName}>
		<a
			class="inline-flex min-w-0 items-center gap-1 text-inherit no-underline"
			{href}
			rel="noopener noreferrer"
			target="_blank"
			title={label}
			onclick={handleLinkClick}
		>
			{@render chipContent()}
		</a>
		<button
			type="button"
			class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors {isLinked
				? 'text-success hover:text-foreground'
				: 'text-muted-foreground/70 hover:text-foreground'}"
			title={isLinked ? `Unlink this chat from #${ref?.number}` : `Link this chat to #${ref?.number}`}
			aria-label={isLinked ? "Unlink pull request from chat" : "Link pull request to chat"}
			onclick={handleToggleClick}
		>
			{#if isLinked}
				{@render unlinkIcon()}
			{:else}
				<HugeiconsIcon name="link" class="size-3" />
			{/if}
		</button>
	</span>
{:else}
	<a
		class={chipClassName}
		{href}
		rel="noopener noreferrer"
		target="_blank"
		title={label}
		onclick={handleLinkClick}
	>
		{@render chipContent()}
	</a>
{/if}
