<script lang="ts">
import { Kanban, Columns, Square, SquaresFour } from "phosphor-svelte";

interface Feature {
	id: string;
	label: string;
	icon: typeof Kanban;
	color: string;
}

const features: Feature[] = [
	{ id: "agent", label: "Side by Side", icon: SquaresFour, color: "#99FFE4" },
	{ id: "by-project", label: "By Project", icon: Columns, color: "#FF8D20" },
	{ id: "single", label: "Single Agent", icon: Square, color: "#9858FF" },
	{ id: "kanban", label: "Kanban", icon: Kanban, color: "#FF78F7" },
];

let activeFeature = $state("agent");
</script>

<div class="flex flex-col gap-2 md:gap-3">
	<!-- Feature selector pills -->
	<div class="flex items-center justify-center gap-2 md:gap-3">
		{#each features as feature (feature.id)}
			{@const isActive = activeFeature === feature.id}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors {isActive
					? 'bg-foreground text-background'
					: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => (activeFeature = feature.id)}
			>
				<feature.icon class="size-4" weight="fill" style="color: {isActive ? 'currentColor' : feature.color}" />
				{feature.label}
			</button>
		{/each}
	</div>

	<!-- Feature content -->
	<div class="relative">
		{#if activeFeature === "agent"}
			{#await import("./agent-panel-demo.svelte")}
				<div class="feature-showcase-loading">Loading demo</div>
			{:then module}
				{@const Demo = module.default}
				<Demo />
			{/await}
		{:else if activeFeature === "by-project"}
			{#await import("./landing-by-project-demo.svelte")}
				<div class="feature-showcase-loading">Loading demo</div>
			{:then module}
				{@const Demo = module.default}
				<Demo />
			{/await}
		{:else if activeFeature === "single"}
			{#await import("./landing-single-demo.svelte")}
				<div class="feature-showcase-loading">Loading demo</div>
			{:then module}
				{@const Demo = module.default}
				<Demo />
			{/await}
		{:else if activeFeature === "kanban"}
			{#await import("./landing-kanban-demo.svelte")}
				<div class="feature-showcase-loading">Loading demo</div>
			{:then module}
				{@const Demo = module.default}
				<Demo />
			{/await}
		{/if}
	</div>
</div>

<style>
	.feature-showcase-loading {
		display: flex;
		aspect-ratio: 16 / 10.5;
		width: 100%;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--background) 72%, transparent);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
</style>
