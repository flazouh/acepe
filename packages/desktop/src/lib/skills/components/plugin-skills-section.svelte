<script lang="ts">
import CaretRight from "phosphor-svelte/lib/CaretRight";
import PuzzlePiece from "phosphor-svelte/lib/PuzzlePiece";
import { SvelteSet } from "svelte/reactivity";
import * as Collapsible from "$lib/components/ui/collapsible/index.js";

import type { PluginInfo, PluginSkill } from "../types/index.js";

import PluginSkillListItem from "./plugin-skill-list-item.svelte";

interface Props {
	plugins: PluginInfo[];
	pluginSkills: Map<string, PluginSkill[]>;
	selectedPluginSkillId: string | null;
	onSelectPluginSkill: (skillId: string) => void;
}

const { plugins, pluginSkills, selectedPluginSkillId, onSelectPluginSkill }: Props = $props();

// Track which plugins are expanded
let expandedPlugins = new SvelteSet<string>();

function togglePlugin(pluginId: string) {
	if (expandedPlugins.has(pluginId)) {
		expandedPlugins.delete(pluginId);
	} else {
		expandedPlugins.add(pluginId);
	}
}

function isExpanded(pluginId: string): boolean {
	return expandedPlugins.has(pluginId);
}

function getPluginSkills(pluginId: string): PluginSkill[] {
	return pluginSkills.get(pluginId) ?? [];
}

// Get total skill count across all plugins
const totalSkillCount = $derived(plugins.reduce((sum, plugin) => sum + plugin.skillCount, 0));
</script>

{#if plugins.length > 0}
	<div class="mb-2 border-b border-border/30 pb-2">
		<!-- Section header -->
		<div class="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
			<PuzzlePiece class="h-3.5 w-3.5 text-muted-foreground" weight="fill" />
			<span class="font-medium">Plugin Skills</span>
			<span class="text-[11px]">({totalSkillCount})</span>
		</div>

		<!-- Plugin list -->
		<div class="flex flex-col gap-0.5 mt-1">
			{#each plugins as plugin (plugin.id)}
				{@const skills = getPluginSkills(plugin.id)}
				{@const expanded = isExpanded(plugin.id)}

				<Collapsible.Root open={expanded} onOpenChange={() => togglePlugin(plugin.id)}>
					<!-- Plugin header -->
					<Collapsible.Trigger
						class="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left hover:bg-accent/40"
					>
						<CaretRight
							class="h-3 w-3 text-muted-foreground transition-transform shrink-0 {expanded
								? 'rotate-90'
								: ''}"
							weight="bold"
						/>
						<span class="flex-1 truncate text-[12px] text-foreground">{plugin.name}</span>
						<span class="shrink-0 text-[11px] text-muted-foreground">{plugin.skillCount}</span>
					</Collapsible.Trigger>

					<!-- Plugin skills -->
					<Collapsible.Content>
						<div class="ml-4 flex flex-col gap-0.5">
							{#each skills as skill (skill.id)}
								<PluginSkillListItem
									{skill}
									isSelected={selectedPluginSkillId === skill.id}
									onSelect={onSelectPluginSkill}
								/>
							{/each}
							{#if skills.length === 0}
								<div class="px-2 py-1.5 text-[11px] text-muted-foreground">Loading skills...</div>
							{/if}
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
			{/each}
		</div>
	</div>
{/if}
