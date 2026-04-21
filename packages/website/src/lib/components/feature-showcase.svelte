<script lang="ts">
import { BrandShaderBackground } from "@acepe/ui";
import { Kanban, Columns, Square, SquaresFour } from "phosphor-svelte";
import AgentPanelDemo from "./agent-panel-demo.svelte";
import LandingByProjectDemo from "./landing-by-project-demo.svelte";
import LandingSingleDemo from "./landing-single-demo.svelte";
import LandingKanbanDemo from "./landing-kanban-demo.svelte";

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

<div class="flex flex-col gap-4">
	<!-- Feature selector pills -->
	<div class="flex items-center justify-center gap-1">
		{#each features as feature (feature.id)}
			{@const isActive = activeFeature === feature.id}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors {isActive
					? 'bg-foreground text-background'
					: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => (activeFeature = feature.id)}
			>
				<feature.icon class="size-4" weight={isActive ? "fill" : "regular"} style="color: {isActive ? 'currentColor' : feature.color}" />
				{feature.label}
			</button>
		{/each}
	</div>

	<!-- Feature content -->
	<div class="relative overflow-hidden rounded-md bg-card/10">
		<BrandShaderBackground class="rounded-xl" fallback="gradient" />
		<div class="relative p-3 md:p-4">
			{#if activeFeature === "agent"}
				<AgentPanelDemo />
			{:else if activeFeature === "by-project"}
				<LandingByProjectDemo />
			{:else if activeFeature === "single"}
				<LandingSingleDemo />
			{:else if activeFeature === "kanban"}
				<LandingKanbanDemo />
			{/if}
		</div>
	</div>
</div>
