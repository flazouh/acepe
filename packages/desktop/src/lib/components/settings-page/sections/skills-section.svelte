<script lang="ts">
import { PlusIcon } from "@acepe/ui";
import SkillsPage from "$lib/skills/components/skills-page.svelte";

let skillsPageRef: ReturnType<typeof SkillsPage> | undefined = $state();
</script>

<div class="flex h-full min-h-0 w-full flex-col">
	<div class="mb-4 flex shrink-0 justify-end">
		<button
			type="button"
			class="flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
			onclick={() => skillsPageRef?.openCreateDialog()}
		>
			<PlusIcon />
			New Skill
		</button>
	</div>
	<div class="min-h-0 flex-1">
		<SkillsPage bind:this={skillsPageRef} />
	</div>
</div>
