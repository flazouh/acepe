<script lang="ts">
import Archive from "phosphor-svelte/lib/Archive";
import ChatCircle from "phosphor-svelte/lib/ChatCircle";
import FolderSimple from "phosphor-svelte/lib/FolderSimple";
import GearFine from "phosphor-svelte/lib/GearFine";
import Keyboard from "phosphor-svelte/lib/Keyboard";
import Microphone from "phosphor-svelte/lib/Microphone";
import Robot from "phosphor-svelte/lib/Robot";
import Stack from "phosphor-svelte/lib/Stack";
import Tree from "phosphor-svelte/lib/Tree";
import * as m from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils.js";

import type { SettingsSectionId } from "./settings-types.js";

type SidebarIcon = typeof GearFine;

interface SidebarSection {
	id: SettingsSectionId;
	icon: SidebarIcon;
	label: () => string;
}

interface Props {
	activeSection: SettingsSectionId;
	onSectionChange: (section: SettingsSectionId) => void;
}

let { activeSection, onSectionChange }: Props = $props();

const sections: readonly SidebarSection[] = [
	{ id: "general", icon: GearFine, label: () => m.settings_general() },
	{ id: "chat", icon: ChatCircle, label: () => m.settings_chat() },
	{ id: "keybindings", icon: Keyboard, label: () => m.settings_keybindings() },
	{ id: "agents", icon: Robot, label: () => "Agents & models" },
	{ id: "voice", icon: Microphone, label: () => m.settings_voice() },
	{ id: "skills", icon: Stack, label: () => m.settings_skills() },
	{ id: "worktrees", icon: Tree, label: () => m.settings_worktree_section() },
	{ id: "project", icon: FolderSimple, label: () => m.settings_project() },
	{ id: "archived", icon: Archive, label: () => "Archived sessions" },
];
</script>

<nav class="flex w-[176px] shrink-0 flex-col border-r border-border/50">
	{#each sections as section (section.id)}
		{@const label = section.label()}
		{@const Icon = section.icon}
		<button
			type="button"
			onclick={() => onSectionChange(section.id)}
			class={cn(
				"flex items-center gap-2.5 px-4 py-1.5 text-[13px] font-medium transition-colors",
				"border-b border-border/10 last:border-b-0",
				"hover:bg-muted/50 hover:text-foreground",
				activeSection === section.id ? "bg-muted text-foreground" : "text-muted-foreground"
			)}
		>
			<Icon weight="fill" class="size-4 shrink-0" />
			<span class="truncate">{label}</span>
		</button>
	{/each}
</nav>
