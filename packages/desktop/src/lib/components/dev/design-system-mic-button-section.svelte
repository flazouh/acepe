<script lang="ts">
import { InputContainer } from "@acepe/ui/input-container";
import { Colors } from "@acepe/ui/colors";

import { Badge } from "$lib/components/ui/badge/index.js";
import SettingRow from "$lib/components/settings-page/setting-row.svelte";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

import DesignSystemMicButtonDemo from "./design-system-mic-button-demo.svelte";
import {
	featuredMicButtonSpecimen,
	micButtonSpecimens,
} from "./design-system-mic-button-specimens.js";

function specimenDescription(specimen: (typeof micButtonSpecimens)[number]): string {
	return `${specimen.caption} · ${specimen.visualState}`;
}
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description="Fused voice control shell as rendered in the composer trailing toolbar — mic primary segment plus voice model overflow menu."
	>
		<InputContainer class="border border-border bg-input/30" contentClass="flex flex-col gap-2 p-2">
			{#snippet content()}
				<div class="flex items-end justify-end gap-2">
					<DesignSystemMicButtonDemo specimen={featuredMicButtonSpecimen} showFusedShell={true} />
				</div>
				<div class="rounded-lg border border-dashed border-border/40 bg-background/40 px-3 py-2.5">
					<p class="text-sm leading-snug text-muted-foreground">Plan, @ for context…</p>
				</div>
			{/snippet}
		</InputContainer>
	</SettingsSection>

	<SettingsSection
		title="Color"
		description="Idle hover uses the shared orange token; recording stop uses Colors.red."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			<SettingRow stacked label="Idle hover" description="Colors.orange · #FF8D20">
				<div class="flex items-center gap-2">
					<span
						class="inline-block size-4 rounded-sm border border-border/40"
						style:background-color={Colors.orange}
					></span>
					<code class="font-mono text-[11px] text-muted-foreground">{Colors.orange}</code>
				</div>
			</SettingRow>
			<SettingRow stacked label="Recording stop" description="Colors.red · #FF5D5A">
				<div class="flex items-center gap-2">
					<span
						class="inline-block size-4 rounded-sm border border-border/40"
						style:background-color={Colors.red}
					></span>
					<code class="font-mono text-[11px] text-muted-foreground">{Colors.red}</code>
				</div>
			</SettingRow>
			<SettingRow
				stacked
				label="Legacy peach (elsewhere)"
				description="Still used by tool tally progress bars — not the mic."
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block size-4 rounded-sm border border-border/40"
						style:background-color="#f9c396"
					></span>
					<code class="font-mono text-[11px] text-muted-foreground">#f9c396</code>
				</div>
			</SettingRow>
		</div>
	</SettingsSection>

	<SettingsSection
		title="All states"
		description="Each specimen is a live render of AgentInputMicButton visual states."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{micButtonSpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each micButtonSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimenDescription(specimen)}>
					<div class="flex items-end rounded-lg border border-border/50 bg-input/30 p-2">
						<DesignSystemMicButtonDemo
							{specimen}
							showFusedShell={specimen.embeddedInGroup}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>
</div>
