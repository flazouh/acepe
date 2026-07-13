<script lang="ts">
	import { InputContainer } from "@acepe/ui/input-container";

	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingRow from "$lib/components/settings-page/setting-row.svelte";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import DesignSystemNewThreadOptionsBarDemo from "./design-system-new-thread-options-bar-demo.svelte";
	import { featuredNewThreadOptionsSpecimen, mockProjects } from "./design-system-new-thread-options-specimens.js";

	let featuredProject = $state(featuredNewThreadOptionsSpecimen.project);
	let featuredAgentId = $state(featuredNewThreadOptionsSpecimen.agentId);
	let featuredWorktreeOn = $state(featuredNewThreadOptionsSpecimen.worktreeOn);
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description="Floating setup chips above a composer shell — project, agent, branch, and worktree controls are interactive. Model and reasoning stay in the composer trailing toolbar."
	>
		<InputContainer class="border border-border bg-input/30" contentClass="flex flex-col gap-2 p-2">
			{#snippet content()}
				<DesignSystemNewThreadOptionsBarDemo
					selectedProject={featuredProject}
					selectedAgentId={featuredAgentId}
					worktreeOn={featuredWorktreeOn}
					showBranch={true}
					onProjectChange={(project) => {
						featuredProject = project;
					}}
					onAgentChange={(agentId) => {
						featuredAgentId = agentId;
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
		title="Variants"
		description="Each control floats as its own chip above the composer, including the standalone worktree toggle."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			<SettingRow stacked label="Without branch" description="Project and agent chips only.">
				<DesignSystemNewThreadOptionsBarDemo
					worktreeOn={false}
					showWorktree={false}
					showBranch={false}
				/>
			</SettingRow>
			<SettingRow stacked label="With branch" description="Branch chip sits beside project and agent.">
				<DesignSystemNewThreadOptionsBarDemo
					selectedProject={mockProjects[0]}
					worktreeOn={false}
					showWorktree={false}
					showBranch={true}
				/>
			</SettingRow>
			<SettingRow stacked label="Worktree off" description="Unchecked worktree toggle; default branch checkout.">
				<DesignSystemNewThreadOptionsBarDemo
					worktreeOn={false}
					showWorktree={true}
					showBranch={true}
				/>
			</SettingRow>
			<SettingRow
				stacked
				label="Worktree on"
				description="Checked green worktree checkbox; isolated worktree branch."
			>
				<DesignSystemNewThreadOptionsBarDemo
					worktreeOn={true}
					showWorktree={true}
					showBranch={true}
				/>
			</SettingRow>
		</div>
	</SettingsSection>
</div>
