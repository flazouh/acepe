<script lang="ts">
import PuzzlePiece from "phosphor-svelte/lib/PuzzlePiece";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";

import type { PluginSkill } from "../types/index.js";

interface Props {
	skill: PluginSkill;
	isSelected: boolean;
	onSelect: (skillId: string) => void;
}

const { skill, isSelected, onSelect }: Props = $props();

// Truncate description to 1-2 lines
function truncateDescription(desc: string | null, maxLength: number = 60): string {
	if (!desc) return "";
	return desc.length > maxLength ? `${desc.slice(0, maxLength)}...` : desc;
}

const truncatedDesc = $derived(truncateDescription(skill.description));
</script>

<button
	type="button"
	class="w-full text-left px-2 py-2 rounded-md hover:bg-accent/50 cursor-pointer flex flex-col gap-1 {isSelected
		? 'bg-accent'
		: ''}"
	onclick={() => onSelect(skill.id)}
>
	<!-- Top row: Skill name -->
	<div class="flex items-center gap-1.5">
		<p class="text-sm line-clamp-2 leading-tight flex-1">{skill.name}</p>
		<Tooltip.Root>
			<Tooltip.Trigger class="shrink-0">
				<PuzzlePiece class="h-3 w-3 text-purple-500" weight="fill" />
			</Tooltip.Trigger>
			<Tooltip.Content side="right" class="text-xs">Plugin skill (read-only)</Tooltip.Content>
		</Tooltip.Root>
	</div>

	<!-- Description -->
	{#if truncatedDesc}
		<div class="text-xs text-muted-foreground line-clamp-2 leading-tight">{truncatedDesc}</div>
	{/if}
</button>
