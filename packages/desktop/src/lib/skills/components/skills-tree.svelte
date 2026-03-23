<script lang="ts">
import { getSkillsStore } from "../store/skills-store.svelte.js";
import SkillsTreeItem from "./skills-tree-item.svelte";

const store = getSkillsStore();

function handleToggle(nodeId: string) {
	store.toggleNode(nodeId);
}

function handleSelect(skillId: string) {
	store.selectSkill(skillId);
}

function handleSelectPluginSkill(skillId: string) {
	store.selectPluginSkill(skillId);
}
</script>

<div class="p-2 space-y-0.5">
	{#if store.loading && store.tree.length === 0}
		<div class="text-sm text-muted-foreground p-2">Loading skills...</div>
	{:else if store.tree.length === 0}
		<div class="text-sm text-muted-foreground p-2">No agents configured</div>
	{:else}
		{#each store.tree as node (node.id)}
			<SkillsTreeItem
				{node}
				depth={0}
				isExpanded={store.isExpanded(node.id)}
				isSelected={store.selectedSkillId === node.id}
				onToggle={handleToggle}
				onSelect={handleSelect}
				onSelectPluginSkill={handleSelectPluginSkill}
			/>
		{/each}
	{/if}
</div>
