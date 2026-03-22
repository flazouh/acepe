<script lang="ts">
	import type { ChangeType } from '@acepe/changelog';
	import { CHANGELOG, groupChangesByType } from '@acepe/changelog';
	import * as m from '$lib/paraglide/messages.js';
	import Header from '$lib/components/header.svelte';
	import PageHero from '$lib/components/page-hero.svelte';
	import { Bug, Lightning, RocketLaunch, Warning } from 'phosphor-svelte';

	let { data } = $props();

	const changeTypeConfig: Record<
		ChangeType,
		{ icon: typeof RocketLaunch; hex: string; label: string }
	> = {
		feature: { icon: RocketLaunch, hex: '#22c55e', label: 'Features' },
		fix: { icon: Bug, hex: '#ef4444', label: 'Fixes' },
		improvement: { icon: Lightning, hex: '#f97316', label: 'Improvements' },
		breaking: { icon: Warning, hex: '#ef4444', label: 'Breaking' }
	};

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="pt-20">
		<PageHero title={m.changelog_page_title()} subtitle={m.changelog_page_description()} />

		<div class="mx-auto max-w-2xl px-6 pb-24 pt-8">
			<div class="flex flex-col gap-12">
				{#each CHANGELOG as entry, entryIndex (entry.version)}
					{@const groups = groupChangesByType(entry.changes)}

					{#if entryIndex > 0}
						<div class="border-t border-border/50"></div>
					{/if}

					<article>
						<div class="mb-6">
							<div
								class="inline-flex items-center gap-2 rounded-full bg-card/70 px-3 py-1 text-[11px] font-medium text-muted-foreground"
							>
								{formatDate(entry.date)}
							</div>
							<h2 class="mt-4 text-2xl font-semibold text-foreground">
								v{entry.version}
							</h2>
							{#if entry.highlights}
								<p class="mt-2 text-sm text-muted-foreground">{entry.highlights}</p>
							{/if}
						</div>

						<div class="flex flex-col gap-3">
							{#each groups as group (group.type)}
								{@const config = changeTypeConfig[group.type]}
								{@const SectionIcon = config.icon}

								<div class="changelog-group">
									<div class="changelog-group-header">
										<span>{config.label}</span>
									</div>

									{#each group.items as change, i (`${entry.version}-${group.type}-${i}`)}
										<div class="changelog-group-row">
											<SectionIcon
												weight="fill"
												class="mt-[0.15em] size-3.5 shrink-0"
												style="color: {config.hex}"
											/>
											<span>{change.description}</span>
										</div>
									{/each}
								</div>
							{/each}
						</div>
					</article>
				{/each}
			</div>
		</div>
	</main>
</div>

<style>
	.changelog-group {
		border-radius: 0.75rem;
		overflow: hidden;
		background: color-mix(in oklab, var(--card) 70%, transparent);
	}

	.changelog-group-header {
		padding: 0.4rem 0.75rem;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
		background: color-mix(in oklab, var(--card) 85%, transparent);
	}

	.changelog-group-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--foreground);
	}

	.changelog-group-row:hover {
		background: color-mix(in oklab, var(--card) 75%, transparent);
	}
</style>
