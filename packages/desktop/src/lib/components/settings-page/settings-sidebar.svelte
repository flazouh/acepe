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
	class="flex w-[208px] shrink-0 flex-col overflow-y-auto border-r border-border/40 px-2 py-3"
	aria-label="Settings sections"
>
	{#each SETTINGS_NAV_GROUPS as group (group.id)}
		{@const groupSections = sectionsForGroup(group.id)}
		{#if groupSections.length > 0}
			<div class="px-2 pb-1 pt-3 first:pt-1">
				<p class="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/55">
					{group.label}
				</p>
			</div>
			<div class="flex flex-col gap-0.5 pb-1">
				{#each groupSections as section (section.id)}
					{@const Icon = section.icon}
					{@const isActive = activeSection === section.id}
					<button
						type="button"
						onclick={() => onSectionChange(section.id)}
						aria-current={isActive ? "page" : undefined}
						class={cn(
							"flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
							"hover:bg-accent hover:text-foreground",
							isActive ? "bg-accent text-foreground" : "text-muted-foreground"
						)}
					>
						<Icon weight="fill" class="size-3.5 shrink-0" />
						<span class="truncate">{section.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/each}
</nav>
