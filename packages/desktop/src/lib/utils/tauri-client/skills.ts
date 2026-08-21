import * as Effect from "effect/Effect";

import type { AppError } from "../../acp/errors/app-error.js";
import { TAURI_COMMAND_CLIENT } from "../../services/tauri-command-client.js";
import type {
	AgentSkills,
	LibrarySkill,
	LibrarySkillWithSync,
	PluginInfo,
	PluginSkill,
	Skill,
	SkillSyncResult,
	SkillTreeNode,
	SyncResult,
	SyncTarget,
} from "../../skills/types/index.js";

const skillCommands = TAURI_COMMAND_CLIENT.skills;

export const skills = {
	listTree: (): Effect.Effect<SkillTreeNode[], AppError> => {
		return skillCommands.list_tree.invoke<SkillTreeNode[]>();
	},

	listAgentSkills: (): Effect.Effect<AgentSkills[], AppError> => {
		return skillCommands.list_agent_skills.invoke<AgentSkills[]>();
	},

	get: (skillId: string): Effect.Effect<Skill, AppError> => {
		return skillCommands.get.invoke<Skill>({ skillId });
	},

	create: (
		agentId: string,
		folderName: string,
		name: string,
		description: string
	): Effect.Effect<Skill, AppError> => {
		return skillCommands.create.invoke<Skill>({
			agentId,
			folderName,
			name,
			description,
		});
	},

	update: (skillId: string, content: string): Effect.Effect<Skill, AppError> => {
		return skillCommands.update.invoke<Skill>({ skillId, content });
	},

	delete: (skillId: string): Effect.Effect<void, AppError> => {
		return skillCommands.delete.invoke<void>({ skillId });
	},

	copyTo: (
		skillId: string,
		targetAgentId: string,
		newFolderName?: string
	): Effect.Effect<Skill, AppError> => {
		return skillCommands.copy_to.invoke<Skill>({ skillId, targetAgentId, newFolderName });
	},

	startWatching: (): Effect.Effect<void, AppError> => {
		return skillCommands.start_watching.invoke<void>();
	},

	stopWatching: (): Effect.Effect<void, AppError> => {
		return skillCommands.stop_watching.invoke<void>();
	},

	listPlugins: (): Effect.Effect<PluginInfo[], AppError> => {
		return skillCommands.list_plugins.invoke<PluginInfo[]>();
	},

	listPluginSkills: (pluginId: string): Effect.Effect<PluginSkill[], AppError> => {
		return skillCommands.list_plugin_skills.invoke<PluginSkill[]>({ pluginId });
	},

	getPluginSkill: (skillId: string): Effect.Effect<PluginSkill, AppError> => {
		return skillCommands.get_plugin_skill.invoke<PluginSkill>({ skillId });
	},

	copyPluginSkillToAgent: (
		skillId: string,
		targetAgentId: string
	): Effect.Effect<Skill, AppError> => {
		return skillCommands.copy_plugin_skill_to_agent.invoke<Skill>({
			skillId,
			targetAgentId,
		});
	},

	libraryListSkills: (): Effect.Effect<LibrarySkill[], AppError> => {
		return skillCommands.library_list_skills.invoke<LibrarySkill[]>();
	},

	libraryListSkillsWithSync: (): Effect.Effect<LibrarySkillWithSync[], AppError> => {
		return skillCommands.library_list_skills_with_sync.invoke<LibrarySkillWithSync[]>();
	},

	libraryGetSkill: (skillId: string): Effect.Effect<LibrarySkillWithSync, AppError> => {
		return skillCommands.library_get_skill.invoke<LibrarySkillWithSync>({ skillId });
	},

	libraryCreateSkill: (
		name: string,
		description: string | null,
		content: string,
		category: string | null
	): Effect.Effect<LibrarySkill, AppError> => {
		return skillCommands.library_create_skill.invoke<LibrarySkill>({
			name,
			description,
			content,
			category,
		});
	},

	libraryUpdateSkill: (
		skillId: string,
		name?: string,
		description?: string | null,
		content?: string,
		category?: string | null
	): Effect.Effect<LibrarySkill, AppError> => {
		return skillCommands.library_update_skill.invoke<LibrarySkill>({
			skillId,
			name,
			description,
			content,
			category,
		});
	},

	libraryDeleteSkill: (skillId: string): Effect.Effect<void, AppError> => {
		return skillCommands.library_delete_skill.invoke<void>({ skillId });
	},

	libraryGetSyncTargets: (skillId: string): Effect.Effect<SyncTarget[], AppError> => {
		return skillCommands.library_get_sync_targets.invoke<SyncTarget[]>({ skillId });
	},

	librarySetSyncTarget: (
		skillId: string,
		agentId: string,
		enabled: boolean
	): Effect.Effect<void, AppError> => {
		return skillCommands.library_set_sync_target.invoke<void>({
			skillId,
			agentId,
			enabled,
		});
	},

	librarySyncSkill: (skillId: string): Effect.Effect<SkillSyncResult[], AppError> => {
		return skillCommands.library_sync_skill.invoke<SkillSyncResult[]>({ skillId });
	},

	librarySyncAll: (): Effect.Effect<SyncResult, AppError> => {
		return skillCommands.library_sync_all.invoke<SyncResult>();
	},

	libraryIsEmpty: (): Effect.Effect<boolean, AppError> => {
		return skillCommands.library_is_empty.invoke<boolean>();
	},

	libraryImportExisting: (): Effect.Effect<LibrarySkill[], AppError> => {
		return skillCommands.library_import_existing.invoke<LibrarySkill[]>();
	},

	libraryGetSkillFolderPath: (
		agentId: string,
		skillName: string
	): Effect.Effect<string | null, AppError> => {
		return skillCommands.library_get_skill_folder_path.invoke<string | null>({
			agentId,
			skillName,
		});
	},

	libraryDeleteSkillFromAgents: (
		skillName: string,
		agentIds: string[]
	): Effect.Effect<SkillSyncResult[], AppError> => {
		return skillCommands.library_delete_skill_from_agents.invoke<SkillSyncResult[]>({
			skillName,
			agentIds,
		});
	},
};
