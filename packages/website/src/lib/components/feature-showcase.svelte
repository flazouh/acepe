<script lang="ts">
import { BrandShaderBackground } from "@acepe/ui";
import { Kanban, GitBranch, ShieldCheck, ListChecks, Terminal } from "phosphor-svelte";
import AgentPanelDemo from "./agent-panel-demo.svelte";
import LandingKanbanDemo from "./landing-kanban-demo.svelte";

interface Feature {
	id: string;
	label: string;
	icon: typeof Kanban;
}

const features: Feature[] = [
	{ id: "agent", label: "Agent Panel", icon: Terminal },
	{ id: "kanban", label: "Kanban Board", icon: Kanban },
	{ id: "checkpoints", label: "Checkpoints", icon: GitBranch },
	{ id: "permissions", label: "Permissions", icon: ShieldCheck },
	{ id: "plans", label: "Plans & Tasks", icon: ListChecks },
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
				class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors {isActive
					? 'bg-foreground text-background'
					: 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
				onclick={() => (activeFeature = feature.id)}
			>
				<feature.icon class="size-3.5" weight={isActive ? "fill" : "regular"} />
				{feature.label}
			</button>
		{/each}
	</div>

	<!-- Feature content -->
	<div class="relative overflow-hidden rounded-md bg-card/10">
		<BrandShaderBackground class="rounded-xl" fallback="gradient" />
		<div class="relative p-2 md:p-3">
			{#if activeFeature === "agent"}
				<AgentPanelDemo />
			{:else if activeFeature === "kanban"}
				<LandingKanbanDemo />
			{:else}
				<div class="flex aspect-[16/10] items-center justify-center rounded-xl border border-border/10 bg-background/50">
					<span class="text-sm text-muted-foreground/50">Coming soon</span>
				</div>
			{/if}
		</div>
	</div>
</div>
