<script lang="ts">
import { AgentPanelConversationEntry } from "@acepe/ui/agent-panel";

import { Badge } from "$lib/components/ui/badge/index.js";
import SettingRow from "$lib/components/settings-page/setting-row.svelte";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

import { compactionActivitySpecimens } from "./design-system-compaction-activity-specimens.js";
</script>

<div class="w-full" data-testid="design-system-compaction-activity-section">
	<SettingsSection
		title="Session states"
		description="Live compaction activity rows at the same width and surface used by the agent transcript."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{compactionActivitySpecimens.length} states
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each compactionActivitySpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimen.caption}>
					<div
						class="w-full max-w-2xl rounded-lg border border-border/50 bg-background p-2"
						data-testid={`design-system-compaction-${specimen.id}`}
					>
						<AgentPanelConversationEntry entry={specimen.entry} />
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>
</div>
