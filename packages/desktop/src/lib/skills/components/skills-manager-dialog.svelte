<script lang="ts">
import { PlusIcon } from "@acepe/ui";
import { Button } from "$lib/components/ui/button/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";

import SkillsPage from "./skills-page.svelte";

interface Props {
	open?: boolean;
}

let { open = $bindable(false) }: Props = $props();

let skillsPageRef: ReturnType<typeof SkillsPage> | undefined = $state();
</script>

<DialogFrame
	bind:open
	title="Skills Manager"
	closeLabel="Close skills manager"
	size="panel"
	contentOverflow="hidden"
>
	{#snippet topLeft()}
		<span class="truncate text-[11px] font-semibold text-foreground select-none">Skills Manager</span>
	{/snippet}

	{#snippet topRight()}
		<Button variant="header" size="header" onclick={() => skillsPageRef?.openCreateDialog()}>
			<PlusIcon />
			New Skill
		</Button>
	{/snippet}

	<SkillsPage bind:this={skillsPageRef} />
</DialogFrame>
