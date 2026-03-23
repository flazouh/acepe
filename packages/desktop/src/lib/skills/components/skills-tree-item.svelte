<script lang="ts">
import { ChevronDown, ChevronRight, FileText, FolderOpen, Puzzle } from "@lucide/svelte/icons";
import AgentIcon from "$lib/acp/components/agent-icon.svelte";
import { cn } from "$lib/utils.js";
import { getSkillsStore } from "../store/skills-store.svelte.js";
import type { SkillTreeNode } from "../types/index.js";
import Self from "./skills-tree-item.svelte";

interface Props {
	node: SkillTreeNode;
	depth?: number;
	isExpanded?: boolean;
	isSelected?: boolean;
	onToggle?: (nodeId: string) => void;
	onSelect?: (nodeId: string) => void;
	onSelectPluginSkill?: (nodeId: string) => void;
}

let {
	node,
	depth = 0,
	isExpanded = false,
	isSelected = false,
	onToggle,
	onSelect,
	onSelectPluginSkill,
}: Props = $props();

const store = getSkillsStore();

const paddingLeft = $derived(depth * 12 + 8);
const isAgent = $derived(node.nodeType === "agent");
const isPluginsSection = $derived(node.nodeType === "plugins-section");
const isPlugin = $derived(node.nodeType === "plugin");
const isPluginSkill = $derived(node.nodeType === "plugin-skill");
const isExpandable = $derived(isAgent || isPluginsSection || isPlugin);

function handleClick() {
	if (isExpandable && onToggle) {
		onToggle(node.id);
	} else if (isPluginSkill && onSelectPluginSkill) {
		onSelectPluginSkill(node.id);
	} else if (!isExpandable && onSelect) {
		onSelect(node.id);
	}
}

function handleKeyDown(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		handleClick();
	}
}
</script>

<div class="select-none">
	<button
		type="button"
		class={cn(
			"flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm",
			"hover:bg-accent hover:text-accent-foreground",
			"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
			isSelected && "bg-accent text-accent-foreground",
			(isAgent || isPluginsSection || isPlugin) && "font-medium",
			isPluginSkill && "text-muted-foreground"
		)}
		style="padding-left: {paddingLeft}px"
		onclick={handleClick}
		onkeydown={handleKeyDown}
	>
		{#if isExpandable}
			{#if isExpanded}
				<ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
			{:else}
				<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
			{/if}
			{#if isPluginsSection}
				<FolderOpen class="h-4 w-4 shrink-0 text-purple-500" />
			{:else if isPlugin}
				<Puzzle class="h-4 w-4 shrink-0 text-purple-500" />
			{:else}
				<AgentIcon agentId={node.agentId} class="shrink-0" size={16} />
			{/if}
		{:else}
			<span class="w-4"></span>
			{#if isPluginSkill}
				<FileText class="h-4 w-4 shrink-0 text-purple-400" />
			{:else}
				<FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
			{/if}
		{/if}
		<span class="truncate">{node.label}</span>
	</button>

	{#if isExpandable && isExpanded && node.children.length > 0}
		<div>
			{#each node.children as child (child.id)}
				<Self
					node={child}
					depth={depth + 1}
					isExpanded={store.isExpanded(child.id)}
					isSelected={store.selectedSkillId === child.id}
					{onToggle}
					{onSelect}
					{onSelectPluginSkill}
				/>
			{/each}
		</div>
	{/if}

	{#if isExpandable && isExpanded && node.children.length === 0}
		<div
			class="text-xs text-muted-foreground italic py-1.5"
			style="padding-left: {paddingLeft + 24}px"
		>
			{isPluginsSection ? "No plugins installed" : isPlugin ? "No skills" : "No skills"}
		</div>
	{/if}
</div>
