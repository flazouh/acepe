<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui";
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
	{#snippet topRight()}
		<Button variant="outline" size="sm" onclick={() => skillsPageRef?.openCreateDialog()}>
			<HugeiconsIcon name="plus" size={14} />
			New Skill
		</Button>
	{/snippet}

	<SkillsPage bind:this={skillsPageRef} />
</DialogFrame>
