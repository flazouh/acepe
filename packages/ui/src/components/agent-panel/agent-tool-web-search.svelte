<script lang="ts">
	import { ArrowSquareOut } from "phosphor-svelte";
	import { CaretDown } from "phosphor-svelte";
	import { CaretRight } from "phosphor-svelte";
	import AgentToolCard from "./agent-tool-card.svelte";
	import {
		getDisplayedWebSearchLinks,
		getHiddenWebSearchLinkCount,
		getWebSearchDomainShortLabel,
		getWebSearchHeaderLabel,
		getWebSearchResultText,
		hasMoreWebSearchLinks,
		hasWebSearchLinks,
		hasWebSearchSummary,
		shouldShowWebSearchNoResults,
		type WebSearchLink,
	} from "./agent-tool-web-search-state.js";
	import ToolHeaderLeading from "./tool-header-leading.svelte";
	import type { AgentToolStatus } from "./types.js";

	interface Props {
		query?: string | null;
		links?: WebSearchLink[];
		summary?: string | null;
		status?: AgentToolStatus;
		durationLabel?: string;
		onLinkClick?: (url: string, title: string) => void;
		searchingLabel?: string;
		searchFailedLabel?: string;
		searchedLabel?: string;
		noResultsLabel?: string;
		resultCountLabel?: (count: number) => string;
		showMoreCollapsedLabel?: (count: number) => string;
		showLessCollapsedLabel?: string;
		showMoreExpandedLabel?: (count: number) => string;
		showLessExpandedLabel?: string;
		ariaExpandResults?: string;
		ariaCollapseResults?: string;
	}

	let {
		query = null,
		links = [],
		summary = null,
		status = "done",
		durationLabel,
		onLinkClick,
		searchingLabel = "Searching",
		searchFailedLabel = "Search Failed",
		searchedLabel = "Searched",
		noResultsLabel = "No results",
		resultCountLabel = (count) => `${count} ${count === 1 ? "result" : "results"}`,
		showMoreCollapsedLabel = (count) => `+${count} more`,
		showLessCollapsedLabel = "show less",
		showMoreExpandedLabel = (count) => `Show ${count} more`,
		showLessExpandedLabel = "Show less",
		ariaExpandResults = "Expand results",
		ariaCollapseResults = "Collapse results",
	}: Props = $props();

	let isCollapsed = $state(true);
	let showAll = $state(false);

	const hasLinks = $derived(hasWebSearchLinks(links));
	const hasSummary = $derived(hasWebSearchSummary(summary));
	const displayedLinks = $derived(getDisplayedWebSearchLinks(links, showAll));
	const hiddenLinkCount = $derived(getHiddenWebSearchLinkCount(links));
	const hasMore = $derived(hasMoreWebSearchLinks(links));
	const resultText = $derived(
		getWebSearchResultText({ status, linkCount: links.length }, resultCountLabel)
	);
	const headerLabel = $derived(
		getWebSearchHeaderLabel(status, {
			searchingLabel,
			searchFailedLabel,
			searchedLabel,
		})
	);
	const showNoResults = $derived(
		shouldShowWebSearchNoResults({ status, hasLinks, hasSummary })
	);
</script>

<!-- Embedded design: contrasted header + body with border -->
<AgentToolCard variant="card" class="flex font-sans shadow-sm">
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header: label + query/count/duration + chevron top right -->
		<div
			class="flex h-6 min-w-0 items-center justify-between gap-2 border-b border-border px-2 bg-muted/40"
		>
			<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
				<ToolHeaderLeading kind="web_search" {status}>{headerLabel}</ToolHeaderLeading>
				{#if query}
					<code class="min-w-0 max-w-[200px] truncate rounded bg-muted px-1 py-px font-sans text-sm text-foreground" title={query}>
						{query}
					</code>
				{/if}
				{#if resultText}
					<span class="text-muted-foreground/80">·</span>
					<span class="font-sans text-sm text-muted-foreground/80">{resultText}</span>
				{/if}
				{#if showNoResults}
					<span class="font-sans text-sm text-muted-foreground/70">{noResultsLabel}</span>
				{/if}
				{#if durationLabel}
					<span class="shrink-0 font-sans text-sm text-muted-foreground/70">{durationLabel}</span>
				{/if}
			</div>
			{#if hasLinks || hasSummary}
				<button
					type="button"
					onclick={() => { isCollapsed = !isCollapsed; }}
					class="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 transition-colors hover:bg-muted"
					aria-label={isCollapsed ? ariaExpandResults : ariaCollapseResults}
				>
					<CaretRight
						size={10}
						weight="bold"
						class="text-muted-foreground transition-transform duration-150 {isCollapsed ? '' : 'rotate-90'}"
					/>
				</button>
			{/if}
		</div>

		<!-- Body: links and summary -->
		{#if hasLinks && isCollapsed}
				<div class="flex flex-col gap-0 px-2 py-1.5 text-sm">
					{#each displayedLinks as link, i (i)}
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							class="group flex items-center gap-1.5 py-px no-underline transition-colors hover:bg-muted/40 rounded px-0.5 -mx-0.5 min-w-0"
							onclick={(e) => {
								if (onLinkClick) {
									e.preventDefault();
									onLinkClick(link.url, link.title);
								}
							}}
						>
							<span class="shrink-0 text-sm text-muted-foreground/50 w-[7ch] text-right tabular-nums">
								{getWebSearchDomainShortLabel(link.domain)}
							</span>
							<span class="text-sm text-muted-foreground truncate">
								{link.title}
							</span>
							<ArrowSquareOut
								size={9}
								weight="regular"
								class="shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</a>
					{/each}
					{#if hasMore}
						<button
							type="button"
							onclick={() => { showAll = !showAll; }}
							class="flex items-center gap-1.5 rounded px-1 py-0.5 text-sm text-muted-foreground/60 transition-colors hover:text-foreground border-none bg-transparent cursor-pointer self-start"
						>
							{#if !showAll}
								<span>{showMoreCollapsedLabel(hiddenLinkCount)}</span>
							{:else}
								<span>{showLessCollapsedLabel}</span>
							{/if}
						</button>
					{/if}
				</div>
			{/if}

			{#if !isCollapsed && (hasLinks || hasSummary)}
				<div class="px-2 py-1.5 text-sm">
					{#if hasSummary && summary}
						<div class="text-muted-foreground leading-relaxed">
							<pre class="m-0 whitespace-pre-wrap break-words text-sm">{summary}</pre>
						</div>
						{#if hasLinks}
							<div class="border-t border-border/50 mt-1.5 pt-1.5" role="separator"></div>
						{/if}
					{/if}

					{#if hasLinks}
						<div class="grid grid-cols-2 gap-px bg-border p-px mt-1">
							{#each displayedLinks as link, i (i)}
								<a
									href={link.url}
									target="_blank"
									rel="noopener noreferrer"
									class="group flex flex-col gap-1 bg-background p-2 no-underline transition-colors hover:bg-muted/40"
									onclick={(e) => {
										if (onLinkClick) {
											e.preventDefault();
											onLinkClick(link.url, link.title);
										}
									}}
								>
									<div class="flex items-center justify-between gap-1.5">
										<span class="truncate text-sm text-muted-foreground/70">
											{link.domain}
										</span>
										<ArrowSquareOut
											size={10}
											weight="regular"
											class="shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
										/>
									</div>
									<span class="text-sm text-foreground line-clamp-2 leading-snug">
										{link.title}
									</span>
								</a>
							{/each}
						</div>

						{#if hasMore}
							<div class="flex justify-center py-1">
								<button
									type="button"
									onclick={() => { showAll = !showAll; }}
									class="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground border-none bg-transparent cursor-pointer"
								>
									{#if !showAll}
										<CaretDown size={10} weight="bold" />
										<span>{showMoreExpandedLabel(hiddenLinkCount)}</span>
									{:else}
										<CaretRight size={10} weight="bold" class="rotate-270" />
										<span>{showLessExpandedLabel}</span>
									{/if}
								</button>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
	</div>
</AgentToolCard>
