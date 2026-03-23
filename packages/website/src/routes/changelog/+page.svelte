<script lang="ts">
	import type { ChangeType } from '@acepe/changelog';
	import { CHANGELOG, groupChangesByType } from '@acepe/changelog';
	import * as m from '$lib/paraglide/messages.js';
	import Header from '$lib/components/header.svelte';
	import { Bug, Lightning, RocketLaunch, Warning } from 'phosphor-svelte';

	let { data } = $props();

	const changeTypeConfig: Record<
		ChangeType,
		{ icon: typeof RocketLaunch; hex: string; label: string }
	> = {
		feature:     { icon: RocketLaunch, hex: '#22c55e', label: 'Features' },
		fix:         { icon: Bug,          hex: '#ef4444', label: 'Fixes' },
		improvement: { icon: Lightning,    hex: '#f97316', label: 'Improvements' },
		breaking:    { icon: Warning,      hex: '#ef4444', label: 'Breaking' },
	};

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
		});
	}
</script>

<svelte:head>
	<title>{m.changelog_page_title()} - Acepe</title>
	<meta name="description" content={m.changelog_page_description()} />
</svelte:head>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="mx-auto max-w-3xl px-4 pt-32 pb-24 md:px-6">
		<!-- Page header -->
		<div class="mb-8">
			<div class="mb-4 flex items-center gap-2">
				<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
				<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">releases</span>
			</div>
			<h1 class="mb-2 text-2xl font-semibold tracking-[-0.03em] md:text-[36px]">{m.changelog_page_title()}</h1>
			<p class="font-mono text-xs text-muted-foreground/50">{m.changelog_page_description()}</p>
		</div>

		<!-- Entries -->
		<div class="flex flex-col gap-2">
			{#each CHANGELOG as entry (entry.version)}
				{@const groups = groupChangesByType(entry.changes)}
				<div class="changelog-card overflow-hidden rounded-xl border border-border/50 bg-card/20">

					<!-- Panel header: version + date -->
					<div class="flex h-9 items-center justify-between border-b border-border/50 px-3">
						<span class="font-mono text-xs font-semibold text-foreground">v{entry.version}</span>
						<span class="font-mono text-[10px] text-muted-foreground/50">{formatDate(entry.date)}</span>
					</div>

					<!-- Highlights row -->
					{#if entry.highlights}
						<div class="border-b border-border/30 px-3 py-2.5">
							<p class="text-[13px] leading-relaxed text-muted-foreground">{entry.highlights}</p>
						</div>
					{/if}

					<!-- Change groups -->
					{#each groups as group (group.type)}
						{@const config = changeTypeConfig[group.type]}
						{@const Icon = config.icon}

						<!-- Group label -->
						<div class="border-b border-border/20 px-3 py-1.5">
							<span class="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider" style="color: {config.hex}">
								<Icon weight="fill" class="size-3 shrink-0" />
								{config.label}
							</span>
						</div>

						<!-- Change items -->
						{#each group.items as change, i}
							<div class="flex items-start px-3 py-2 {i < group.items.length - 1 ? 'border-b border-border/20' : ''} hover:bg-card/40 transition-colors">
								<span class="text-[13px] leading-relaxed text-muted-foreground">{change.description}</span>
							</div>
						{/each}
					{/each}
				</div>
			{/each}
		</div>
	</main>
</div>

<style>
	.changelog-card {
		backdrop-filter: blur(12px);
	}
</style>
