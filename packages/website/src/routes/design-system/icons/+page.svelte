<script lang="ts">
import {
	formatRoundedIconName,
	getRoundedIconMigrationDecision,
	getRoundedIconFallbackData,
	LinearInventoryIcon,
	linearIconCatalogHash,
	linearIconCoverage,
	linearIconLibrary,
	resolveRoundedIconName,
	roundedIconMigrationManifest,
	type LinearIconLibraryEntry,
} from "@acepe/ui/icons";
import DesignSystemHeader from "$lib/design-system/design-system-header.svelte";

let searchQuery = $state("");
let reviewScope = $state<"all" | "confirmed" | "fallbacks" | "inventory">("all");
const migrationIconNames = Array.from(roundedIconMigrationManifest.keys());
const migrationEntries = Array.from(roundedIconMigrationManifest.entries());
const fallbackIcons = migrationIconNames.filter(
	(name) => getRoundedIconMigrationDecision(name).state === "no-equivalent"
);
const migrationDecisions = Array.from(roundedIconMigrationManifest.values());
const approvedCount = migrationDecisions.filter((decision) => decision.state === "approved-linear").length;
const noEquivalentCount = migrationDecisions.filter((decision) => decision.state === "no-equivalent").length;
const unresolvedCount = migrationDecisions.filter((decision) => decision.state === "unresolved").length;

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
	linearIconLibrary.filter((icon) => matchesIconQuery(icon, searchQuery))
);
const filteredFallbacks = $derived(
	fallbackIcons.filter((name) =>
		`${name} ${formatRoundedIconName(name)}`
			.toLowerCase()
			.includes(searchQuery.trim().toLowerCase())
	)
);
</script>

<svelte:head>
	<title>Icons | Acepe Design System</title>
	<meta
		name="description"
		content="Linear-derived icon inventory for Acepe design review."
	/>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
	<DesignSystemHeader active="icons" />
<main class="px-6 py-10 sm:px-8" data-testid="design-system-icons-page">
	<div class="mx-auto mb-6 max-w-[92rem] space-y-4">
		<div class="space-y-1">
			<h1 class="text-lg font-medium text-foreground">Icon provenance</h1>
			<p class="text-sm text-muted-foreground">
				{approvedCount} approved mappings · {noEquivalentCount} reviewed with no equivalent · {unresolvedCount} still under semantic review · {filteredIcons.length} of {linearIconLibrary.length} catalog entries · {linearIconCoverage.stats.extracted} extracted · {linearIconCoverage.stats.excluded} classified non-icons/runtime renderers · {linearIconCoverage.stats.needsReview} need parser review · catalog {linearIconCatalogHash.slice(0, 12)}
			</p>
		</div>

		<div class="flex flex-wrap items-end gap-3">
			<label class="block min-w-64 flex-1 space-y-2">
				<span class="text-sm font-medium text-foreground">Search icons</span>
				<input
					bind:value={searchQuery}
					class="w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-border focus:bg-card"
					data-testid="design-system-icon-search"
					placeholder="Search by label, name, or source chunk"
					type="search"
				/>
			</label>
			<label class="block min-w-44 space-y-2">
				<span class="text-sm font-medium text-foreground">Review scope</span>
				<select
					bind:value={reviewScope}
					class="w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground outline-none focus:border-border"
					data-testid="design-system-icon-review-scope"
				>
					<option value="all">All sections</option>
					<option value="confirmed">Confirmed mappings</option>
					<option value="fallbacks">Acepe fallbacks</option>
					<option value="inventory">Linear inventory</option>
				</select>
			</label>
		</div>
	</div>

	{#if reviewScope === "all" || reviewScope === "confirmed"}
	<section class="mx-auto mb-8 max-w-[92rem] space-y-3" aria-labelledby="confirmed-heading">
		<div>
			<h2 id="confirmed-heading" class="text-sm font-medium text-foreground">Confirmed mappings</h2>
			<p class="text-xs text-muted-foreground">All previous runtime mappings are invalidated until each Linear control is retraced with same-intent evidence.</p>
		</div>
		<div class="divide-y divide-border/40 rounded-md border border-border/50 bg-card/35">
			{#if approvedCount === 0}
				<p class="px-3 py-3 text-xs text-muted-foreground" data-testid="design-system-icons-no-confirmed-mappings">
					No active Linear runtime mappings. Acepe's original icon geometry is rendering while the Linear set is re-audited control by control.
				</p>
			{/if}
			{#each migrationEntries as [acepeName, decision] (acepeName)}
				{#if decision.state === "approved-linear"}
					{@const evidence = decision.evidence}
				<div class="grid gap-3 px-3 py-3 sm:grid-cols-[8rem_5rem_1fr] sm:items-center" data-evidence-state={evidence.evidenceState} data-source-set={evidence.sourceSet === null ? evidence.sourceType : evidence.sourceSet}>
					<span class="truncate font-mono text-[11px] text-foreground">{acepeName}</span>
					<div class="flex items-center gap-2">
						<span aria-hidden="true" class="text-muted-foreground">→</span>
						<LinearInventoryIcon name={evidence.linearName} class="size-4 shrink-0" aria-label={`Linear ${evidence.linearName}`} />
					</div>
					<div class="min-w-0">
						<p class="truncate text-xs text-foreground">{evidence.controlLabel}</p>
						<p class="truncate text-[11px] text-muted-foreground">Approved · {evidence.sourceSet === null ? evidence.sourceType : evidence.sourceSet} · {evidence.surface} · Linear {evidence.observedBuild}</p>
						<p class="truncate font-mono text-[9px] text-muted-foreground">{evidence.sourceChunk} · {evidence.geometryHash.slice(0, 12)} · {evidence.observationMethod}</p>
						{#if evidence.categoryExceptionReason !== null}
							<p class="mt-1 text-[10px] text-muted-foreground">{evidence.categoryExceptionReason}</p>
						{/if}
					</div>
				</div>
				{/if}
			{/each}
		</div>
	</section>
	{/if}

	{#if reviewScope === "all" || reviewScope === "fallbacks"}
	<section class="mx-auto mb-8 max-w-[92rem] space-y-3" aria-labelledby="fallback-heading" data-testid="acepe-icon-fallbacks">
		<div class="flex items-baseline justify-between gap-4">
			<div>
				<h2 id="fallback-heading" class="text-sm font-medium text-foreground">Acepe fallbacks</h2>
				<p class="text-xs text-muted-foreground">Original geometry remains active for every runtime icon until the same control meaning is observed in Linear.</p>
			</div>
			<span class="text-xs tabular-nums text-muted-foreground">{filteredFallbacks.length}</span>
		</div>
		<div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-px overflow-hidden rounded-md border border-border/50 bg-border/40">
			{#each filteredFallbacks as name (name)}
				{@const icon = getRoundedIconFallbackData(resolveRoundedIconName(name))}
				{@const decision = getRoundedIconMigrationDecision(name)}
				<article class="flex min-w-0 items-center gap-2 bg-background px-3 py-2.5" data-migration-state={decision.state} data-testid={`acepe-icon-fallback-${name}`} title={decision.rationale}>
					<svg class="size-4 shrink-0 text-muted-foreground" viewBox={icon.viewBox} role="img" aria-label={formatRoundedIconName(name)} xmlns="http://www.w3.org/2000/svg">
						{@html icon.inner}
					</svg>
					<div class="min-w-0">
						<p class="truncate font-mono text-[10px] text-foreground">{name}</p>
						<p class="truncate text-[9px] text-muted-foreground">
							{decision.state === "no-equivalent" ? "No equivalent · Acepe geometry retained" : "Under investigation"}
						</p>
					</div>
				</article>
			{/each}
		</div>
	</section>
	{/if}

	{#if reviewScope === "all" || reviewScope === "inventory"}
	<section class="mx-auto max-w-[92rem] space-y-3" aria-labelledby="inventory-heading">
		<div class="flex items-baseline justify-between gap-4">
			<div>
				<h2 id="inventory-heading" class="text-sm font-medium text-foreground">Linear inventory</h2>
				<p class="text-xs text-muted-foreground">Extracted availability does not approve a runtime mapping.</p>
			</div>
			<span class="text-xs tabular-nums text-muted-foreground">{filteredIcons.length}</span>
		</div>
	<div
		class="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3"
		data-testid="design-system-icon-grid"
	>
		{#each filteredIcons as icon (icon.name)}
			<article
				class="flex flex-col items-center gap-2 rounded-md border border-border/50 bg-card/45 px-2 py-3 text-center text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
				data-testid={`design-system-icon-tile-${icon.name}`}
				title={`${icon.label} (${icon.sourceChunk})`}
			>
				<LinearInventoryIcon
					name={icon.name}
					class="size-5 shrink-0"
					aria-label={icon.label}
				/>
				<div class="min-w-0 space-y-0.5">
					<p class="truncate text-[11px] font-medium text-foreground">{icon.label}</p>
					<p class="truncate text-[10px] text-muted-foreground">{icon.name}</p>
					<p class="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{icon.sourceSet === null ? icon.sourceType : icon.sourceSet}</p>
				</div>
			</article>
		{/each}
	</div>
	</section>
	{/if}

	{#if filteredIcons.length === 0}
		<p class="mx-auto max-w-[92rem] text-sm text-muted-foreground" data-testid="design-system-icon-empty">
			No icons match “{searchQuery.trim()}”.
		</p>
	{/if}
</main>
</div>
