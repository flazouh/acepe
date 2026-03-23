import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import type {
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
import { CMD } from "./commands.js";
import { invokeAsync } from "./invoke.js";

export const skills = {
	listTree: (): ResultAsync<SkillTreeNode[], AppError> => {
		return invokeAsync(CMD.skills.list_tree);
	},

	get: (skillId: string): ResultAsync<Skill, AppError> => {
		return invokeAsync(CMD.skills.get, { skillId });
	},

	create: (
		agentId: string,
		folderName: string,
		name: string,
		description: string
	): ResultAsync<Skill, AppError> => {
		return invokeAsync(CMD.skills.create, {
			agentId,
			folderName,
			name,
			description,
		});
	},

	update: (skillId: string, content: string): ResultAsync<Skill, AppError> => {
		return invokeAsync(CMD.skills.update, { skillId, content });
	},

	delete: (skillId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.skills.delete, { skillId });
	},

	copyTo: (
		skillId: string,
		targetAgentId: string,
		newFolderName?: string
	): ResultAsync<Skill, AppError> => {
		return invokeAsync(CMD.skills.copy_to, { skillId, targetAgentId, newFolderName });
	},

	startWatching: (): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.skills.start_watching);
	},

	stopWatching: (): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.skills.stop_watching);
	},

	listPlugins: (): ResultAsync<PluginInfo[], AppError> => {
		return invokeAsync(CMD.skills.list_plugins);
	},

	listPluginSkills: (pluginId: string): ResultAsync<PluginSkill[], AppError> => {
		return invokeAsync(CMD.skills.list_plugin_skills, { pluginId });
	},

	getPluginSkill: (skillId: string): ResultAsync<PluginSkill, AppError> => {
		return invokeAsync(CMD.skills.get_plugin_skill, { skillId });
	},

	copyPluginSkillToAgent: (
		skillId: string,
		targetAgentId: string
	): ResultAsync<Skill, AppError> => {
		return invokeAsync(CMD.skills.copy_plugin_skill_to_agent, {
			skillId,
			targetAgentId,
		});
	},

	libraryListSkills: (): ResultAsync<LibrarySkill[], AppError> => {
		return invokeAsync(CMD.skills.library_list_skills);
	},

	libraryListSkillsWithSync: (): ResultAsync<LibrarySkillWithSync[], AppError> => {
		return invokeAsync(CMD.skills.library_list_skills_with_sync);
	},

	libraryGetSkill: (skillId: string): ResultAsync<LibrarySkillWithSync, AppError> => {
		return invokeAsync(CMD.skills.library_get_skill, { skillId });
	},

	libraryCreateSkill: (
		name: string,
		description: string | null,
		content: string,
		category: string | null
	): ResultAsync<LibrarySkill, AppError> => {
		return invokeAsync(CMD.skills.library_create_skill, {
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
		return invokeAsync(CMD.skills.library_update_skill, {
			skillId,
			name,
			description,
			content,
			category,
		});
	},

	libraryDeleteSkill: (skillId: string): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.skills.library_delete_skill, { skillId });
	},

	libraryGetSyncTargets: (skillId: string): ResultAsync<SyncTarget[], AppError> => {
		return invokeAsync(CMD.skills.library_get_sync_targets, { skillId });
	},

	librarySetSyncTarget: (
		skillId: string,
		agentId: string,
		enabled: boolean
	): ResultAsync<void, AppError> => {
		return invokeAsync(CMD.skills.library_set_sync_target, {
			skillId,
			agentId,
			enabled,
		});
	},

	librarySyncSkill: (skillId: string): ResultAsync<SkillSyncResult[], AppError> => {
		return invokeAsync(CMD.skills.library_sync_skill, { skillId });
	},

	librarySyncAll: (): ResultAsync<SyncResult, AppError> => {
		return invokeAsync(CMD.skills.library_sync_all);
	},

	libraryIsEmpty: (): ResultAsync<boolean, AppError> => {
		return invokeAsync(CMD.skills.library_is_empty);
	},

	libraryImportExisting: (): ResultAsync<LibrarySkill[], AppError> => {
		return invokeAsync(CMD.skills.library_import_existing);
	},

	libraryGetSkillFolderPath: (
		agentId: string,
		skillName: string
	): ResultAsync<string | null, AppError> => {
		return invokeAsync(CMD.skills.library_get_skill_folder_path, {
			agentId,
			skillName,
		});
	},

	libraryDeleteSkillFromAgents: (
		skillName: string,
		agentIds: string[]
	): ResultAsync<SkillSyncResult[], AppError> => {
		return invokeAsync(CMD.skills.library_delete_skill_from_agents, {
			skillName,
			agentIds,
		});
	},
};
