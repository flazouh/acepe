<script lang="ts">
	import {
		formatHugeiconsIconName,
		HugeiconsIcon,
		hugeiconsIconLibrary,
	} from "@acepe/ui/icons";
	import DesignSystemHeader from "$lib/design-system/design-system-header.svelte";

	let searchQuery = $state("");

	const filteredIcons = $derived.by(() => {
		const query = searchQuery.trim().toLowerCase();
		if (query.length === 0) {
			return hugeiconsIconLibrary;
		}

		return hugeiconsIconLibrary.filter(
			(icon) => icon.name.includes(query) || icon.label.toLowerCase().includes(query),
		);
	});
</script>

<svelte:head>
	<title>Icons | Acepe Design System</title>
	<meta
		name="description"
		content="The shared Hugeicons icon set used across Acepe."
	/>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	<DesignSystemHeader active="icons" />
	<main class="px-6 py-10 sm:px-8" data-testid="design-system-icons-page">
		<div class="mx-auto mb-6 max-w-[92rem] space-y-4">
			<div class="space-y-1">
				<h1 class="text-lg font-medium text-foreground">Hugeicons</h1>
				<p class="text-sm text-muted-foreground">
					{hugeiconsIconLibrary.length} shared icons · one renderer · no legacy icon geometry
				</p>
			</div>

			<label class="block max-w-xl space-y-2">
				<span class="text-sm font-medium text-foreground">Search icons</span>
				<input
					bind:value={searchQuery}
					class="w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-border focus:bg-card"
					data-testid="design-system-icon-search"
					placeholder="Search by name"
					type="search"
				/>
			</label>
		</div>

		<section class="mx-auto max-w-[92rem] space-y-3" aria-labelledby="icons-heading">
			<div class="flex items-baseline justify-between gap-4">
				<div>
					<h2 id="icons-heading" class="text-sm font-medium text-foreground">Shared icon library</h2>
					<p class="text-xs text-muted-foreground">
						Every tile below renders through HugeiconsIcon.
					</p>
				</div>
				<span class="text-xs tabular-nums text-muted-foreground">{filteredIcons.length}</span>
			</div>

			{#if filteredIcons.length > 0}
				<div
					class="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
					data-testid="design-system-icon-grid"
				>
					{#each filteredIcons as icon (icon.name)}
						<article
							class="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-card/45 px-2 py-3 text-center text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
							data-testid={`design-system-icon-tile-${icon.name}`}
						>
							<HugeiconsIcon
								name={icon.name}
								class="size-6 shrink-0"
								aria-label={formatHugeiconsIconName(icon.name)}
							/>
							<div class="min-w-0 space-y-0.5">
								<p class="truncate text-[11px] font-medium text-foreground">{icon.label}</p>
								<p class="truncate text-[10px] text-muted-foreground">{icon.name}</p>
							</div>
						</article>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground" data-testid="design-system-icon-empty">
					No icons match “{searchQuery.trim()}”.
				</p>
			{/if}
		</section>
	</main>
</div>
