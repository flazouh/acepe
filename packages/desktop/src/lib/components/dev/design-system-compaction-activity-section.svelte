<script lang="ts">
	import { AgentSessionActivityEntryView } from "@acepe/ui/agent-panel";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingRow from "$lib/components/settings-page/setting-row.svelte";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import {
		compactionActivitySpecimens,
		type CompactionActivitySpecimen,
	} from "./design-system-compaction-activity-specimens.js";

	const featuredSpecimen = compactionActivitySpecimens.find(
		(specimen) => specimen.id === "completed"
	);

	function specimenDescription(specimen: CompactionActivitySpecimen): string {
		return `${specimen.caption} · ${specimen.entry.status}`;
	}
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description="The compaction seam between transcript messages at a realistic agent-panel width."
	>
		{#if featuredSpecimen}
			<div class="rounded-lg border border-border/40 bg-card p-3">
				<div class="mx-auto flex w-full max-w-[680px] flex-col">
					<p class="py-1.5 text-sm text-foreground/90">
						I've finished the migration plan — all twelve services now use the shared retry
						policy. Next I'll wire the health checks into the deploy gate.
					</p>
					<AgentSessionActivityEntryView
						title={featuredSpecimen.entry.title}
						status={featuredSpecimen.entry.status}
						subtitle={featuredSpecimen.entry.subtitle}
						contextUsage={featuredSpecimen.entry.contextUsage}
						metadata={featuredSpecimen.entry.metadata}
					/>
					<p class="py-1.5 text-sm text-foreground/90">
						Continuing with the deploy gate: the health-check endpoint already exists, so I'll
						start by registering it in the pipeline config.
					</p>
				</div>
			</div>
		{/if}
	</SettingsSection>

	<SettingsSection
		title="States"
		description="Preparing shimmers with no determinate progress; completed leads with before/after context pressure; usage reset and failed swap the gauges for a quiet icon."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{compactionActivitySpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each compactionActivitySpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimenDescription(specimen)}>
					<div class="w-full max-w-[680px]">
						<AgentSessionActivityEntryView
							title={specimen.entry.title}
							status={specimen.entry.status}
							subtitle={specimen.entry.subtitle}
							contextUsage={specimen.entry.contextUsage}
							metadata={specimen.entry.metadata}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="Narrow transcript"
		description="The seam at a cramped panel width: title truncates, counts stay legible, detail wraps."
	>
		<div class="rounded-lg border border-border/40 bg-card p-3">
			<div class="w-[320px] border-r border-dashed border-border/40 pr-2">
				{#each compactionActivitySpecimens as specimen (specimen.id)}
					<AgentSessionActivityEntryView
						title={specimen.entry.title}
						status={specimen.entry.status}
						subtitle={specimen.entry.subtitle}
						contextUsage={specimen.entry.contextUsage}
						metadata={specimen.entry.metadata}
					/>
				{/each}
			</div>
		</div>
	</SettingsSection>
</div>
