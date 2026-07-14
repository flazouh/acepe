<script lang="ts">
import { HugeiconsIcon } from "@acepe/ui/icons";
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
	class="flex w-full flex-col px-1 py-1"
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
							"flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] font-medium transition-colors duration-150",
							isActive
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
						)}
					>
						{#if section.interfaceIcon}
							<HugeiconsIcon
								name={section.interfaceIcon}
								data-testid={`settings-section-${section.id}-icon`}
								class={cn(
									"size-3.5 shrink-0 transition-colors",
									isActive ? "text-foreground" : "text-muted-foreground"
								)}
							/>
						{:else if section.iconName}
							<HugeiconsIcon
								name={section.iconName}
								data-testid={`settings-section-${section.id}-icon`}
								class={cn(
									"size-3.5 shrink-0 transition-colors",
									isActive ? "text-foreground" : "text-muted-foreground"
								)}
							/>
						{:else if Icon}
							<Icon
								weight="fill"
								class={cn(
									"size-3.5 shrink-0 transition-colors",
									isActive ? "text-foreground" : "text-muted-foreground"
								)}
							/>
						{/if}
						<span class="truncate">{section.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/each}
</nav>
