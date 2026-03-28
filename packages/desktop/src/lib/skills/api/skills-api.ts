/**
 * API layer for Skills Manager.
 *
 * Provides type-safe wrappers around Tauri commands for skills operations.
 * All functions return ResultAsync for consistent error handling.
 */

import { listen } from "@tauri-apps/api/event";
import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../acp/errors/app-error.js";
import { tauriClient } from "../../utils/tauri-client.js";
import type {
	LibrarySkill,
	LibrarySkillWithSync,
	PluginInfo,
	PluginSkill,
	Skill,
	SkillsChangedEvent,
	SkillTreeNode,
	SyncResult,
	SyncTarget,
} from "../types/index.js";

/**
 * List all agents and their skills as a tree structure.
 */
export function listTree(): ResultAsync<SkillTreeNode[], AppError> {
	return tauriClient.skills.listTree();
}

/**
 * Get a specific skill by ID.
 */
export function getSkill(skillId: string): ResultAsync<Skill, AppError> {
	return tauriClient.skills.get(skillId);
}

/**
 * Create a new skill.
 */
export function createSkill(
	agentId: string,
	folderName: string,
	name: string,
	description: string
): ResultAsync<Skill, AppError> {
	return tauriClient.skills.create(agentId, folderName, name, description);
}

/**
 * Update an existing skill's content.
 */
export function updateSkill(skillId: string, content: string): ResultAsync<Skill, AppError> {
	return tauriClient.skills.update(skillId, content);
}

/**
 * Delete a skill.
 */
export function deleteSkill(skillId: string): ResultAsync<void, AppError> {
	return tauriClient.skills.delete(skillId);
}

/**
 * Copy a skill to another agent.
 */
export function copySkillTo(
	skillId: string,
	targetAgentId: string,
	newFolderName?: string
): ResultAsync<Skill, AppError> {
	return tauriClient.skills.copyTo(skillId, targetAgentId, newFolderName);
}

/**
 * Start watching for skill file changes.
 */
export function startWatching(): ResultAsync<void, AppError> {
	return tauriClient.skills.startWatching();
}

/**
 * Stop watching for skill file changes.
 */
export function stopWatching(): ResultAsync<void, AppError> {
	return tauriClient.skills.stopWatching();
}

/**
 * Subscribe to skills changed events.
 * Returns an unsubscribe function.
 */
export function onSkillsChanged(
	callback: (event: SkillsChangedEvent) => void
): Promise<() => void> {
	return listen<SkillsChangedEvent>("skills:changed", (event) => {
		callback(event.payload);
	});
}

/**
 * Skills API object for convenient access.
 */
export const skillsApi = {
	listTree,
	getSkill,
	createSkill,
	updateSkill,
	deleteSkill,
	copySkillTo,
	startWatching,
	stopWatching,
	onSkillsChanged,
};

// ============================================================================
// Plugin Skills API
// ============================================================================

/**
 * List all discovered plugins with skills.
 */
export function listPlugins(): ResultAsync<PluginInfo[], AppError> {
	return tauriClient.skills.listPlugins();
}

/**
 * List all skills for a specific plugin.
 */
export function listPluginSkills(pluginId: string): ResultAsync<PluginSkill[], AppError> {
	return tauriClient.skills.listPluginSkills(pluginId);
}

/**
 * Get a specific plugin skill by ID.
 */
export function getPluginSkill(skillId: string): ResultAsync<PluginSkill, AppError> {
	return tauriClient.skills.getPluginSkill(skillId);
}

/**
 * Copy a plugin skill to a user's agent directory.
 */
export function copyPluginSkillToAgent(
	skillId: string,
	targetAgentId: string
): ResultAsync<Skill, AppError> {
	return tauriClient.skills.copyPluginSkillToAgent(skillId, targetAgentId);
}

/**
 * Plugin Skills API object for convenient access.
 */
export const pluginSkillsApi = {
	listPlugins,
	listPluginSkills,
	getPluginSkill,
	copyPluginSkillToAgent,
};

// ============================================================================
// Unified Skills Library API
// ============================================================================

/**
 * List all skills from the library.
 */
export function libraryListSkills(): ResultAsync<LibrarySkill[], AppError> {
	return tauriClient.skills.libraryListSkills();
}

/**
 * List all skills with their sync status.
 */
export function libraryListSkillsWithSync(): ResultAsync<LibrarySkillWithSync[], AppError> {
	return tauriClient.skills.libraryListSkillsWithSync();
}

/**
 * Get a single skill with its sync status.
 */
export function libraryGetSkill(skillId: string): ResultAsync<LibrarySkillWithSync, AppError> {
	return tauriClient.skills.libraryGetSkill(skillId);
}

/**
 * Create a new skill in the library.
 */
export function libraryCreateSkill(
	name: string,
	description: string | null,
	content: string,
	category: string | null
): ResultAsync<LibrarySkill, AppError> {
	return tauriClient.skills.libraryCreateSkill(name, description, content, category);
}

/**
 * Update a skill in the library.
 */
export function libraryUpdateSkill(
	skillId: string,
	name?: string,
	description?: string | null,
	content?: string,
	category?: string | null
): ResultAsync<LibrarySkill, AppError> {
	return tauriClient.skills.libraryUpdateSkill(skillId, name, description, content, category);
}

/**
 * Delete a skill from the library.
 */
export function libraryDeleteSkill(skillId: string): ResultAsync<void, AppError> {
	return tauriClient.skills.libraryDeleteSkill(skillId);
}

/**
 * Get sync targets for a skill.
 */
export function libraryGetSyncTargets(skillId: string): ResultAsync<SyncTarget[], AppError> {
	return tauriClient.skills.libraryGetSyncTargets(skillId);
}

/**
 * Set sync target enabled/disabled for a skill.
 */
export function librarySetSyncTarget(
	skillId: string,
	agentId: string,
	enabled: boolean
): ResultAsync<void, AppError> {
	return tauriClient.skills.librarySetSyncTarget(skillId, agentId, enabled);
}

/**
 * Sync a single skill to all enabled agents.
 */
export function librarySyncSkill(
	skillId: string
): ResultAsync<import("../types/sync-result.js").SkillSyncResult[], AppError> {
	return tauriClient.skills.librarySyncSkill(skillId);
}

/**
 * Sync all skills to all enabled agents.
 */
export function librarySyncAll(): ResultAsync<SyncResult, AppError> {
	return tauriClient.skills.librarySyncAll();
}

/**
 * Check if the library is empty (first run detection).
 */
export function libraryIsEmpty(): ResultAsync<boolean, AppError> {
	return tauriClient.skills.libraryIsEmpty();
}

/**
 * Import existing skills from agent directories into the library.
 */
export function libraryImportExisting(): ResultAsync<LibrarySkill[], AppError> {
	return tauriClient.skills.libraryImportExisting();
}

/**
 * Get the skill folder path for a specific agent.
 */
export function libraryGetSkillFolderPath(
	agentId: string,
	skillName: string
): ResultAsync<string | null, AppError> {
	return tauriClient.skills.libraryGetSkillFolderPath(agentId, skillName);
}

/**
 * Delete skill files from specified agent directories.
 */
export function libraryDeleteSkillFromAgents(
	skillName: string,
	agentIds: string[]
): ResultAsync<import("../types/sync-result.js").SkillSyncResult[], AppError> {
	return tauriClient.skills.libraryDeleteSkillFromAgents(skillName, agentIds);
}

/**
 * Unified Skills Library API object.
 */
export const libraryApi = {
	listSkills: libraryListSkills,
	listSkillsWithSync: libraryListSkillsWithSync,
	getSkill: libraryGetSkill,
	createSkill: libraryCreateSkill,
	updateSkill: libraryUpdateSkill,
	deleteSkill: libraryDeleteSkill,
	getSyncTargets: libraryGetSyncTargets,
	setSyncTarget: librarySetSyncTarget,
	syncSkill: librarySyncSkill,
	syncAll: librarySyncAll,
	isEmpty: libraryIsEmpty,
	importExisting: libraryImportExisting,
	getSkillFolderPath: libraryGetSkillFolderPath,
	deleteSkillFromAgents: libraryDeleteSkillFromAgents,
};
