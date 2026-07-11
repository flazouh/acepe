<script lang="ts">
import {
	LinearInventoryIcon,
	linearIconCatalogHash,
	linearIconLibrary,
	type LinearIconLibraryEntry,
} from "$lib/design-system/linear-icons.js";

let searchQuery = $state("");

function matchesIconQuery(icon: LinearIconLibraryEntry, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (normalizedQuery.length === 0) {
		return true;
	}

	return (
		icon.name.includes(normalizedQuery) ||
		icon.label.toLowerCase().includes(normalizedQuery) ||
		icon.sourceChunk.toLowerCase().includes(normalizedQuery)
	);
}

const filteredIcons = $derived(
	linearIconLibrary.filter((icon) => matchesIconQuery(icon, searchQuery)),
);
</script>

<svelte:head>
	<title>Icons | Acepe Design System</title>
	<meta
		name="description"
		content="Linear-derived icon inventory for Acepe design review."
	/>
</svelte:head>

<main
	class="min-h-screen bg-background px-6 py-6 text-foreground sm:px-8"
	data-testid="design-system-icons-page"
>
	<div class="mx-auto mb-6 max-w-[92rem] space-y-4">
		<div class="space-y-1">
			<h1 class="text-lg font-medium text-foreground">Linear icon inventory</h1>
			<p class="text-sm text-muted-foreground">
				{filteredIcons.length} of {linearIconLibrary.length} icons · catalog {linearIconCatalogHash.slice(0, 12)}
			</p>
		</div>

		<label class="block max-w-md space-y-2">
			<span class="text-sm font-medium text-foreground">Search icons</span>
			<input
				bind:value={searchQuery}
				class="w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-border focus:bg-card"
				data-testid="design-system-icon-search"
				placeholder="Search by label, name, or source chunk"
				type="search"
			/>
		</label>
	</div>

	<div
		class="mx-auto grid max-w-[92rem] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3"
		data-testid="design-system-icon-grid"
	>
		{#each filteredIcons as icon (icon.name)}
			<article
				class="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-card/45 px-2 py-3 text-center text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
				data-testid={`design-system-icon-tile-${icon.name}`}
				title={`${icon.label} (${icon.sourceChunk})`}
			>
				<LinearInventoryIcon name={icon.name} class="size-5 shrink-0" aria-hidden="true" />
				<div class="min-w-0 space-y-0.5">
					<p class="truncate text-[11px] font-medium text-foreground">{icon.label}</p>
					<p class="truncate text-[10px] text-muted-foreground">{icon.name}</p>
				</div>
			</article>
		{/each}
	</div>

	{#if filteredIcons.length === 0}
		<p class="mx-auto max-w-[92rem] text-sm text-muted-foreground" data-testid="design-system-icon-empty">
			No icons match “{searchQuery.trim()}”.
		</p>
	{/if}
</main>
