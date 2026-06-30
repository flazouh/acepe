import type { Component } from "svelte";
import {
	Archive,
	ChartLine,
	ChatCircle,
	FolderSimple,
	GearFine,
	GitBranch,
	Keyboard,
	Palette,
	Plugs,
	PuzzlePiece,
	Robot,
	Tree,
} from "phosphor-svelte";

import type { SettingsSectionId } from "./settings-types.js";

export type SettingsNavGroupId = "general" | "agents" | "workspace" | "data";

export interface SettingsNavGroup {
	readonly id: SettingsNavGroupId;
	readonly label: string;
}

export interface SettingsSectionDefinition {
	readonly id: SettingsSectionId;
	readonly label: string;
	readonly description: string;
	readonly icon: Component;
	readonly groupId: SettingsNavGroupId;
	readonly fullWidth?: boolean;
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
	{ id: "general", label: "General" },
	{ id: "agents", label: "Agents" },
	{ id: "workspace", label: "Workspace" },
	{ id: "data", label: "Data" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
	{
		id: "general",
		label: "General",
		description: "Notifications, telemetry, and app-wide behavior.",
		icon: GearFine,
		groupId: "general",
	},
	{
		id: "appearance",
		label: "Appearance",
		description: "Choose how Acepe looks.",
		icon: Palette,
		groupId: "general",
	},
	{
		id: "keybindings",
		label: "Keybindings",
		description: "Customize keyboard shortcuts across the app.",
		icon: Keyboard,
		groupId: "general",
		fullWidth: true,
	},
	{
		id: "agents",
		label: "Agents & models",
		description: "Choose which agents are enabled and set defaults.",
		icon: Robot,
		groupId: "agents",
		fullWidth: true,
	},
	{
		id: "chat",
		label: "Chat",
		description: "Composer and transcript behavior.",
		icon: ChatCircle,
		groupId: "agents",
	},
	{
		id: "skills",
		label: "Skills",
		description: "Create and manage reusable local skills.",
		icon: PuzzlePiece,
		groupId: "agents",
		fullWidth: true,
	},
	{
		id: "mcp",
		label: "MCP servers",
		description: "Model Context Protocol servers extend agents with external tools.",
		icon: Plugs,
		groupId: "agents",
	},
	{
		id: "project",
		label: "Projects",
		description: "Manage project-scoped settings.",
		icon: FolderSimple,
		groupId: "workspace",
		fullWidth: true,
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Default behavior for worktree-aware sessions.",
		icon: Tree,
		groupId: "workspace",
	},
	{
		id: "environments",
		label: "Environments",
		description: "Environment files and per-agent overrides.",
		icon: FolderSimple,
		groupId: "workspace",
	},
	{
		id: "git",
		label: "Git",
		description: "Git-related preferences and review behavior.",
		icon: GitBranch,
		groupId: "workspace",
	},
	{
		id: "archived",
		label: "Archived sessions",
		description: "Sessions hidden from the sidebar. Unarchive to restore them.",
		icon: Archive,
		groupId: "data",
		fullWidth: true,
	},
	{
		id: "usage",
		label: "Usage",
		description: "Token and session usage insights.",
		icon: ChartLine,
		groupId: "data",
	},
];

export function getSettingsSectionDefinition(
	id: SettingsSectionId
): SettingsSectionDefinition {
	const match = SETTINGS_SECTIONS.find((section) => section.id === id);
	if (match) {
		return match;
	}

	return SETTINGS_SECTIONS[0];
}
