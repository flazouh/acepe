<script lang="ts" generics="TGroup extends { projectName: string; projectColor: string }">
	import type { Snippet } from "svelte";

	import { ProjectCard } from "../project-card/index.js";

	interface Props {
		groups: TGroup[];
		groupRenderer: Snippet<[TGroup]>;
	}

	let { groups, groupRenderer }: Props = $props();
</script>

<div class="flex flex-row items-stretch gap-0.5 overflow-x-auto flex-1 min-h-0">
	{#each groups as group (group.projectName)}
		<ProjectCard
			projectName={group.projectName}
			projectColor={group.projectColor}
			variant="corner"
		>
			{@render groupRenderer(group)}
		</ProjectCard>
	{/each}
</div>
