<script lang="ts">
	import {
		ClaudeWorkingSpark,
		PlanningPlaceholderRow,
		type ToolDurationTiming,
		CLAUDE_WORKING_SPARK_DURATION_MS,
		CLAUDE_WORKING_SPARK_FRAME_COUNT,
	} from "@acepe/ui/agent-panel";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingRow from "$lib/components/settings-page/setting-row.svelte";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import { claudeSparkSpecimens } from "./design-system-claude-spark-specimens.js";

	const brand = "#d97757";

	// The genuine running-turn timing, exactly as the agent panel builds it, so the
	// real PlanningPlaceholderRow ticks its seconds counter.
	const planningTiming: ToolDurationTiming = {
		startedAtMs: Date.now() - 3000,
		completedAtMs: null,
		status: "running",
	};
</script>

<div class="w-full">
	<SettingsSection
		title="Hero"
		description="Enlarged so the logo morph through its shapes is clearly visible. Loops forever."
	>
		<div
			class="flex items-center justify-center rounded-lg border border-border/40 bg-card py-12"
		>
			<ClaudeWorkingSpark size={120} label="Claude working spark" />
		</div>
	</SettingsSection>

	<SettingsSection
		title="In context"
		description="The real PlanningPlaceholderRow with showWorkingSpark — exactly what the agent panel renders while Claude streams: the spark replaces the label, and the seconds timer keeps ticking."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3 py-3">
			<PlanningPlaceholderRow timing={planningTiming} showWorkingSpark />
		</div>
	</SettingsSection>

	<SettingsSection
		title="Sizes"
		description="The same sprite scales cleanly — the mask fills the box at any size."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{claudeSparkSpecimens.length} sizes
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each claudeSparkSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimen.caption}>
					<div class="flex items-center rounded-lg border border-border/50 bg-input/30 p-3">
						<ClaudeWorkingSpark size={specimen.size} />
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="Spec"
		description="Reverse-engineered from the Claude desktop app's epitaxy-spark-working asset."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			<SettingRow stacked label="Frames" description="84-frame WebP sprite, 48×48 per frame">
				<code class="font-mono text-[11px] text-muted-foreground">
					{CLAUDE_WORKING_SPARK_FRAME_COUNT} frames
				</code>
			</SettingRow>
			<SettingRow stacked label="Duration" description="steps(84, jump-none) translateY loop">
				<code class="font-mono text-[11px] text-muted-foreground">
					{CLAUDE_WORKING_SPARK_DURATION_MS}ms
				</code>
			</SettingRow>
			<SettingRow
				stacked
				label="Tint"
				description="currentColor over an alpha mask — not an <img>. Override `color` to re-tint."
			>
				<div class="flex items-center gap-2">
					<span
						class="inline-block size-4 rounded-sm border border-border/40"
						style:background-color={brand}
					></span>
					<code class="font-mono text-[11px] text-muted-foreground">{brand}</code>
				</div>
			</SettingRow>
		</div>
	</SettingsSection>
</div>
