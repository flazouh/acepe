<script lang="ts" generics="TTab">
	import type { Snippet } from "svelte";

	import { ProjectCard } from "../project-card/index.js";

	interface Props {
		groups: {
			projectName: string;
			projectColor: string;
			projectIconSrc?: string | null;
			tabs: readonly TTab[];
		}[];
		tabRenderer: Snippet<[TTab]>;
	}

	let { groups, tabRenderer }: Props = $props();
</script>

<div class="flex items-stretch gap-1 overflow-x-auto" role="tablist">
	{#each groups as group (group.projectName)}
		<ProjectCard
			projectName={group.projectName}
			projectColor={group.projectColor}
			projectIconSrc={group.projectIconSrc}
			variant="inline"
		>
			{#each group.tabs as tab}
				{@render tabRenderer(tab)}
			{/each}
		</ProjectCard>
	{/each}
</div>
