<script lang="ts">
import { cn } from "$lib/utils.js";

import {
	SETTINGS_NAV_GROUPS,
	SETTINGS_SECTIONS,
	type SettingsNavGroupId,
} from "./settings-section-registry.js";
import type { SettingsSectionId } from "./settings-types.js";

interface Props {
	activeSection: SettingsSectionId;
	onSectionChange: (section: SettingsSectionId) => void;
}

let { activeSection, onSectionChange }: Props = $props();

function sectionsForGroup(groupId: SettingsNavGroupId) {
	return SETTINGS_SECTIONS.filter((section) => section.groupId === groupId);
}
</script>

<nav
	class="flex w-[168px] shrink-0 flex-col overflow-y-auto border-r border-border/40 bg-input/10 px-1.5 py-1.5"
	aria-label="Settings sections"
>
	{#each SETTINGS_NAV_GROUPS as group (group.id)}
		{@const groupSections = sectionsForGroup(group.id)}
		{#if groupSections.length > 0}
			<div class="px-1.5 pb-0.5 pt-1.5 first:pt-0.5">
				<p class="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
					{group.label}
				</p>
			</div>
			<div class="flex flex-col gap-px pb-1">
				{#each groupSections as section (section.id)}
					{@const Icon = section.icon}
					{@const isActive = activeSection === section.id}
					<button
						type="button"
						onclick={() => onSectionChange(section.id)}
						aria-current={isActive ? "page" : undefined}
						class={cn(
							"flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium transition-colors",
							"hover:bg-accent hover:text-foreground",
							isActive ? "bg-accent text-foreground" : "text-muted-foreground"
						)}
					>
						<Icon weight="fill" class="size-3 shrink-0" />
						<span class="truncate">{section.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/each}
</nav>
