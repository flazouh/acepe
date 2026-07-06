<script lang="ts">
import { SidebarUpdateCard } from "@acepe/ui/app-layout";

import { Badge } from "$lib/components/ui/badge/index.js";
import SettingRow from "$lib/components/settings-page/setting-row.svelte";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import {
	featuredUpdateCardVariant,
	updateCardStateSpecimens,
	updateCardVariantSpecimens,
	type UpdateCardStateSpecimen,
} from "./design-system-update-card-specimens.js";

const SIDEBAR_PREVIEW_WIDTH = "272px";

function variantDescription(
	specimen: (typeof updateCardVariantSpecimens)[number],
): string {
	return specimen.description;
}

function stateDescription(specimen: UpdateCardStateSpecimen): string {
	return specimen.caption;
}
</script>

<div class="w-full">
	<SettingsSection
		title="Gradient variants"
		description="Ten grain-gradient presets — shape, palette, and silhouette."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{updateCardVariantSpecimens.length} variants
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each updateCardVariantSpecimens as specimen (specimen.id)}
				<SettingRow
					stacked
					label={specimen.label}
					description={variantDescription(specimen)}
				>
					<div
						class="rounded-lg border border-dashed border-border/40 bg-sidebar p-2"
						style:width={SIDEBAR_PREVIEW_WIDTH}
					>
						<SidebarUpdateCard
							variant={specimen.id}
							kind="available"
							version="2026.4.4"
							onclick={() => {}}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="All states"
		description="State matrix for the featured variant ({featuredUpdateCardVariant})."
	>
		{#snippet headerActions()}
			<Badge variant="outline" class="font-mono text-[10px]">
				{featuredUpdateCardVariant}
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each updateCardStateSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={stateDescription(specimen)}>
					<div
						class="rounded-lg border border-dashed border-border/40 bg-sidebar p-2"
						style:width={SIDEBAR_PREVIEW_WIDTH}
					>
						<SidebarUpdateCard
							variant={featuredUpdateCardVariant}
							kind={specimen.kind}
							version={specimen.version}
							percent={specimen.percent}
							onclick={() => {}}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="In context"
		description="Featured variant above sidebar footer chrome."
	>
		<div
			class="flex flex-col gap-0 rounded-lg border border-border/40 bg-sidebar"
			style:width={SIDEBAR_PREVIEW_WIDTH}
		>
			<div class="p-2">
				<SidebarUpdateCard
					variant={featuredUpdateCardVariant}
					kind="available"
					version="2026.4.4"
					onclick={() => {}}
				/>
			</div>
			<div class="flex items-center gap-0.5 border-t border-border/40 px-2 py-1.5">
				<span class="text-[10px] text-muted-foreground/50">GitHub · X · Discord</span>
				<span class="ml-auto font-mono text-[9px] text-muted-foreground/50">v2026.4.3</span>
			</div>
		</div>
	</SettingsSection>
</div>
