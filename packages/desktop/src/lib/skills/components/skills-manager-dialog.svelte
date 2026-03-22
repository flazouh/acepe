<script lang="ts">
import { Plus } from "@lucide/svelte/icons";
import { Button } from "$lib/components/ui/button/index.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "$lib/components/ui/dialog/index.js";

import SkillsPage from "./skills-page.svelte";

interface Props {
	open?: boolean;
}

let { open = $bindable(false) }: Props = $props();

let skillsPageRef: ReturnType<typeof SkillsPage> | undefined = $state();
</script>

<Dialog bind:open>
	<DialogContent class="max-w-5xl h-[70vh] max-h-[700px] overflow-hidden p-0 gap-0 flex flex-col">
		<DialogHeader class="px-4 py-3 border-b shrink-0">
			<div class="flex flex-row items-center justify-start gap-4">
				<DialogTitle>Skills Manager</DialogTitle>
				<Button variant="ghost" onclick={() => skillsPageRef?.openCreateDialog()} title="New Skill">
					<Plus class="h-4 w-4 mr-1" />
					New Skill
				</Button>
			</div>
		</DialogHeader>
		<div class="flex-1 min-h-0 overflow-hidden">
			<SkillsPage bind:this={skillsPageRef} />
		</div>
	</DialogContent>
</Dialog>
