<script lang="ts">
	import { InputContainer } from "@acepe/ui/input-container";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingRow from "$lib/components/settings-page/setting-row.svelte";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import DesignSystemNewThreadOptionsBarDemo from "./design-system-new-thread-options-bar-demo.svelte";
	import {
		buildReasoningConfigOption,
		featuredNewThreadOptionsSpecimen,
		mockProjects,
		reasoningLevelSpecimens,
	} from "./design-system-new-thread-options-specimens.js";

	let featuredProject = $state(featuredNewThreadOptionsSpecimen.project);
	let featuredAgentId = $state(featuredNewThreadOptionsSpecimen.agentId);
	let featuredModelId = $state(featuredNewThreadOptionsSpecimen.modelId);
	let featuredReasoningValue = $state(featuredNewThreadOptionsSpecimen.reasoningValue);
	let featuredWorktreeOn = $state(featuredNewThreadOptionsSpecimen.worktreeOn);

	const featuredReasoningOption = $derived(buildReasoningConfigOption(featuredReasoningValue));
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description="Live setup row above a composer shell — controls are interactive."
	>
		<InputContainer class="border border-border bg-input/30" contentClass="flex flex-col gap-2 p-2">
			{#snippet content()}
				<DesignSystemNewThreadOptionsBarDemo
					selectedProject={featuredProject}
					selectedAgentId={featuredAgentId}
					selectedModelId={featuredModelId}
					reasoningOption={featuredReasoningOption}
					worktreeOn={featuredWorktreeOn}
					onProjectChange={(project) => {
						featuredProject = project;
					}}
					onAgentChange={(agentId) => {
						featuredAgentId = agentId;
					}}
					onModelChange={(modelId) => {
						featuredModelId = modelId;
					}}
					onReasoningChange={(_configId, value) => {
						featuredReasoningValue = value;
					}}
					onWorktreeToggle={(on) => {
						featuredWorktreeOn = on;
					}}
				/>
				<div class="rounded-lg border border-dashed border-border/40 bg-background/40 px-3 py-2.5">
					<p class="text-sm leading-snug text-muted-foreground">Plan, @ for context…</p>
				</div>
			{/snippet}
		</InputContainer>
	</SettingsSection>

	<SettingsSection
		title="Reasoning levels"
		description="Reasoning effort grouped with the model picker — bar-only control, one filled segment per level."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{reasoningLevelSpecimens.length} levels
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each reasoningLevelSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimen.caption}>
					<DesignSystemNewThreadOptionsBarDemo
						selectedProject={mockProjects[0]}
						selectedAgentId="codex"
						selectedModelId="gpt-5.5"
						reasoningOption={buildReasoningConfigOption(specimen.currentValue)}
						worktreeOn={false}
						showWorktree={false}
					/>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="Variants"
		description="Optional regions and grouped controls in the setup row."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			<SettingRow stacked label="Without reasoning" description="Model picker only; no reasoning group.">
				<DesignSystemNewThreadOptionsBarDemo
					reasoningOption={null}
					worktreeOn={false}
					showWorktree={false}
				/>
			</SettingRow>
			<SettingRow stacked label="Worktree off" description="Outline tree icon with label; default branch checkout.">
				<DesignSystemNewThreadOptionsBarDemo
					reasoningOption={buildReasoningConfigOption("medium")}
					worktreeOn={false}
					showWorktree={true}
				/>
			</SettingRow>
			<SettingRow
				stacked
				label="Worktree on"
				description="Filled green tree icon; isolated worktree branch."
			>
				<DesignSystemNewThreadOptionsBarDemo
					reasoningOption={buildReasoningConfigOption("medium")}
					worktreeOn={true}
					showWorktree={true}
				/>
			</SettingRow>
		</div>
	</SettingsSection>
</div>
