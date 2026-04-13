import type { ResultAsync } from "neverthrow";

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
	listTree: (): ResultAsync<SkillTreeNode[], AppError> => {
		return skillCommands.list_tree.invoke<SkillTreeNode[]>();
	},

	listAgentSkills: (): ResultAsync<AgentSkills[], AppError> => {
		return skillCommands.list_agent_skills.invoke<AgentSkills[]>();
	},

	get: (skillId: string): ResultAsync<Skill, AppError> => {
		return skillCommands.get.invoke<Skill>({ skillId });
	},

	create: (
		agentId: string,
		folderName: string,
		name: string,
		description: string
	): ResultAsync<Skill, AppError> => {
		return skillCommands.create.invoke<Skill>({
			agentId,
			folderName,
			name,
			description,
		});
	},

	update: (skillId: string, content: string): ResultAsync<Skill, AppError> => {
		return skillCommands.update.invoke<Skill>({ skillId, content });
	},

	delete: (skillId: string): ResultAsync<void, AppError> => {
		return skillCommands.delete.invoke<void>({ skillId });
	},

	copyTo: (
		skillId: string,
		targetAgentId: string,
		newFolderName?: string
	): ResultAsync<Skill, AppError> => {
		return skillCommands.copy_to.invoke<Skill>({ skillId, targetAgentId, newFolderName });
	},

	startWatching: (): ResultAsync<void, AppError> => {
		return skillCommands.start_watching.invoke<void>();
	},

	stopWatching: (): ResultAsync<void, AppError> => {
		return skillCommands.stop_watching.invoke<void>();
	},

	listPlugins: (): ResultAsync<PluginInfo[], AppError> => {
		return skillCommands.list_plugins.invoke<PluginInfo[]>();
	},

	listPluginSkills: (pluginId: string): ResultAsync<PluginSkill[], AppError> => {
		return skillCommands.list_plugin_skills.invoke<PluginSkill[]>({ pluginId });
	},

	getPluginSkill: (skillId: string): ResultAsync<PluginSkill, AppError> => {
		return skillCommands.get_plugin_skill.invoke<PluginSkill>({ skillId });
	},

	copyPluginSkillToAgent: (
		skillId: string,
		targetAgentId: string
	): ResultAsync<Skill, AppError> => {
		return skillCommands.copy_plugin_skill_to_agent.invoke<Skill>({
			skillId,
			targetAgentId,
		});
	},

	libraryListSkills: (): ResultAsync<LibrarySkill[], AppError> => {
		return skillCommands.library_list_skills.invoke<LibrarySkill[]>();
	},

	libraryListSkillsWithSync: (): ResultAsync<LibrarySkillWithSync[], AppError> => {
		return skillCommands.library_list_skills_with_sync.invoke<LibrarySkillWithSync[]>();
	},

	libraryGetSkill: (skillId: string): ResultAsync<LibrarySkillWithSync, AppError> => {
		return skillCommands.library_get_skill.invoke<LibrarySkillWithSync>({ skillId });
	},

	libraryCreateSkill: (
		name: string,
		description: string | null,
		content: string,
		category: string | null
	): ResultAsync<LibrarySkill, AppError> => {
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
	): ResultAsync<LibrarySkill, AppError> => {
		return skillCommands.library_update_skill.invoke<LibrarySkill>({
			skillId,
			name,
			description,
			content,
			category,
		});
	},

	libraryDeleteSkill: (skillId: string): ResultAsync<void, AppError> => {
		return skillCommands.library_delete_skill.invoke<void>({ skillId });
	},

	libraryGetSyncTargets: (skillId: string): ResultAsync<SyncTarget[], AppError> => {
		return skillCommands.library_get_sync_targets.invoke<SyncTarget[]>({ skillId });
	},

	librarySetSyncTarget: (
		skillId: string,
		agentId: string,
		enabled: boolean
	): ResultAsync<void, AppError> => {
		return skillCommands.library_set_sync_target.invoke<void>({
			skillId,
			agentId,
			enabled,
		});
	},

	librarySyncSkill: (skillId: string): ResultAsync<SkillSyncResult[], AppError> => {
		return skillCommands.library_sync_skill.invoke<SkillSyncResult[]>({ skillId });
	},

	librarySyncAll: (): ResultAsync<SyncResult, AppError> => {
		return skillCommands.library_sync_all.invoke<SyncResult>();
	},

	libraryIsEmpty: (): ResultAsync<boolean, AppError> => {
		return skillCommands.library_is_empty.invoke<boolean>();
	},

	libraryImportExisting: (): ResultAsync<LibrarySkill[], AppError> => {
		return skillCommands.library_import_existing.invoke<LibrarySkill[]>();
	},

	libraryGetSkillFolderPath: (
		agentId: string,
		skillName: string
	): ResultAsync<string | null, AppError> => {
		return skillCommands.library_get_skill_folder_path.invoke<string | null>({
			agentId,
			skillName,
		});
	},

	libraryDeleteSkillFromAgents: (
		skillName: string,
		agentIds: string[]
	): ResultAsync<SkillSyncResult[], AppError> => {
		return skillCommands.library_delete_skill_from_agents.invoke<SkillSyncResult[]>({
			skillName,
			agentIds,
		});
	},
};
