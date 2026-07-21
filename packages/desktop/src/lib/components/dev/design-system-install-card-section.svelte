<script lang="ts">
import { InputContainer } from "@acepe/ui/input-container";

import AgentInstallCard from "$lib/acp/components/agent-panel/components/agent-install-card.svelte";
import { Badge } from "$lib/components/ui/badge/index.js";
import SettingRow from "$lib/components/settings-page/setting-row.svelte";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

import {
	featuredInstallCardSpecimen,
	installCardSpecimens,
} from "./design-system-install-card-specimens.js";

function formatProgress(progress: number): string {
	const percent = progress < 0 ? 0 : progress > 1 ? 100 : Math.round(progress * 100);
	return `${percent}%`;
}

function specimenDescription(specimen: (typeof installCardSpecimens)[number]): string {
	return `${specimen.caption} · ${specimen.agentId} · ${formatProgress(specimen.progress)}`;
}
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description={featuredInstallCardSpecimen.caption}
	>
		<InputContainer class="border border-border bg-input/30" contentClass="flex flex-col gap-2 p-2">
			{#snippet content()}
				<AgentInstallCard
					agentId={featuredInstallCardSpecimen.agentId}
					agentName={featuredInstallCardSpecimen.agentName}
					stage={featuredInstallCardSpecimen.stage}
					progress={featuredInstallCardSpecimen.progress}
				/>
				<div class="rounded-lg border border-dashed border-border/40 bg-background/40 px-3 py-2.5">
					<p class="text-sm leading-snug text-muted-foreground">Plan, @ for context…</p>
				</div>
			{/snippet}
		</InputContainer>
	</SettingsSection>

	<SettingsSection
		title="All states"
		description="Each specimen is a live render — click a row to expand install logs."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{installCardSpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each installCardSpecimens as specimen (specimen.id)}
				<SettingRow
					stacked
					label={specimen.label}
					description={specimenDescription(specimen)}
				>
					<div class="rounded-lg border border-border/50 bg-input/30 p-2">
						<AgentInstallCard
							agentId={specimen.agentId}
							agentName={specimen.agentName}
							stage={specimen.stage}
							progress={specimen.progress}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>
</div>
