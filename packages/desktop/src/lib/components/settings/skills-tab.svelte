<script lang="ts">
import { Plus } from "@lucide/svelte/icons";

import { Button } from "$lib/components/ui/button/index.js";
import SkillsPage from "$lib/skills/components/skills-page.svelte";

let skillsPageRef: ReturnType<typeof SkillsPage> | undefined = $state();
</script>

<div class="flex flex-col h-full min-h-0 -m-6">
	<div class="flex items-center justify-between px-4 py-3 border-b shrink-0">
		<h2 class="text-lg font-semibold">Skills Manager</h2>
		<Button variant="ghost" onclick={() => skillsPageRef?.openCreateDialog()} title="New Skill">
			<Plus class="h-4 w-4 mr-1" />
			New Skill
		</Button>
	</div>
	<div class="flex-1 min-h-0 overflow-hidden">
		<SkillsPage bind:this={skillsPageRef} />
	</div>
</div>
