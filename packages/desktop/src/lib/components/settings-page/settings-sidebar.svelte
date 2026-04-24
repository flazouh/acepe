<script lang="ts">
import {
	Archive,
	ChartLine,
	ChatCircle,
	FolderSimple,
	GearFine,
	GitBranch,
	Keyboard,
	Microphone,
	Palette,
	Plugs,
	PuzzlePiece,
	Robot,
	Tree,
} from "phosphor-svelte";
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
	{ id: "general", icon: GearFine, label: () => "General" },
	{ id: "appearance", icon: Palette, label: () => "Appearance" },
	{ id: "agents", icon: Robot, label: () => "Agents" },
	{ id: "chat", icon: ChatCircle, label: () => "Chat" },
	{ id: "voice", icon: Microphone, label: () => "Voice" },
	{ id: "skills", icon: PuzzlePiece, label: () => "Skills" },
	{ id: "keybindings", icon: Keyboard, label: () => "Keybindings" },
	{ id: "mcp", icon: Plugs, label: () => "MCP servers" },
	{ id: "git", icon: GitBranch, label: () => "Git" },
	{ id: "project", icon: FolderSimple, label: () => "Projects" },
	{ id: "environments", icon: FolderSimple, label: () => "Environments" },
	{ id: "worktrees", icon: Tree, label: () => "Worktrees" },
	{ id: "archived", icon: Archive, label: () => "Archived sessions" },
	{ id: "usage", icon: ChartLine, label: () => "Usage" },
];
</script>

<nav class="flex w-[220px] shrink-0 flex-col gap-px border-r border-border/60 bg-muted/20 px-2 py-4">
	{#each sections as section (section.id)}
		{@const label = section.label()}
		{@const Icon = section.icon}
		<button
			type="button"
			onclick={() => onSectionChange(section.id)}
			class={cn(
				"flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
				"hover:bg-muted/60 hover:text-foreground",
				activeSection === section.id ? "bg-muted text-foreground" : "text-muted-foreground"
			)}
		>
			<Icon weight="fill" class="size-4 shrink-0" />
			<span class="truncate">{label}</span>
		</button>
	{/each}
</nav>
