<script lang="ts">
import { Plus } from "phosphor-svelte";
import SkillsPage from "$lib/skills/components/skills-page.svelte";
import SettingsSectionHeader from "../settings-section-header.svelte";

let skillsPageRef: ReturnType<typeof SkillsPage> | undefined = $state();
</script>

<div class="flex h-full w-full flex-col">
	<SettingsSectionHeader title="Skills" description="Create and manage reusable local skills.">
		{#snippet actions()}
			<button
				type="button"
				class="flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => skillsPageRef?.openCreateDialog()}
			>
				<Plus class="size-3" weight="bold" />
				New Skill
			</button>
		{/snippet}
	</SettingsSectionHeader>
	<div class="flex-1 min-h-0 overflow-hidden rounded-lg bg-muted/20 shadow-sm">
		<SkillsPage bind:this={skillsPageRef} />
	</div>
</div>
