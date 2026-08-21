/**
 * API layer for Skills Manager.
 *
 * Provides type-safe wrappers around Tauri commands for skills operations.
 * All functions return Effect for consistent error handling.
 */

import { listen } from "@tauri-apps/api/event";
import * as Effect from "effect/Effect";
import type { AppError } from "../../acp/errors/app-error.js";
import { tauriClient } from "../../utils/tauri-client.js";
import type {
	AgentSkills,
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
export function listTree(): Effect.Effect<SkillTreeNode[], AppError> {
	return tauriClient.skills.listTree();
}

/**
 * List parsed on-disk skills grouped by agent.
 */
export function listAgentSkills(): Effect.Effect<AgentSkills[], AppError> {
	return tauriClient.skills.listAgentSkills();
}

/**
 * Get a specific skill by ID.
 */
export function getSkill(skillId: string): Effect.Effect<Skill, AppError> {
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
): Effect.Effect<Skill, AppError> {
	return tauriClient.skills.create(agentId, folderName, name, description);
}

/**
 * Update an existing skill's content.
 */
export function updateSkill(skillId: string, content: string): Effect.Effect<Skill, AppError> {
	return tauriClient.skills.update(skillId, content);
}

/**
 * Delete a skill.
 */
export function deleteSkill(skillId: string): Effect.Effect<void, AppError> {
	return tauriClient.skills.delete(skillId);
}

/**
 * Copy a skill to another agent.
 */
export function copySkillTo(
	skillId: string,
	targetAgentId: string,
	newFolderName?: string
): Effect.Effect<Skill, AppError> {
	return tauriClient.skills.copyTo(skillId, targetAgentId, newFolderName);
}

/**
 * Start watching for skill file changes.
 */
export function startWatching(): Effect.Effect<void, AppError> {
	return tauriClient.skills.startWatching();
}

/**
 * Stop watching for skill file changes.
 */
export function stopWatching(): Effect.Effect<void, AppError> {
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
	listAgentSkills,
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
export function listPlugins(): Effect.Effect<PluginInfo[], AppError> {
	return tauriClient.skills.listPlugins();
}

/**
 * List all skills for a specific plugin.
 */
export function listPluginSkills(pluginId: string): Effect.Effect<PluginSkill[], AppError> {
	return tauriClient.skills.listPluginSkills(pluginId);
}

/**
 * Get a specific plugin skill by ID.
 */
export function getPluginSkill(skillId: string): Effect.Effect<PluginSkill, AppError> {
	return tauriClient.skills.getPluginSkill(skillId);
}

/**
 * Copy a plugin skill to a user's agent directory.
 */
export function copyPluginSkillToAgent(
	skillId: string,
	targetAgentId: string
): Effect.Effect<Skill, AppError> {
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
export function libraryListSkills(): Effect.Effect<LibrarySkill[], AppError> {
	return tauriClient.skills.libraryListSkills();
}

/**
 * List all skills with their sync status.
 */
export function libraryListSkillsWithSync(): Effect.Effect<LibrarySkillWithSync[], AppError> {
	return tauriClient.skills.libraryListSkillsWithSync();
}

/**
 * Get a single skill with its sync status.
 */
export function libraryGetSkill(skillId: string): Effect.Effect<LibrarySkillWithSync, AppError> {
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
): Effect.Effect<LibrarySkill, AppError> {
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
): Effect.Effect<LibrarySkill, AppError> {
	return tauriClient.skills.libraryUpdateSkill(skillId, name, description, content, category);
}

/**
 * Delete a skill from the library.
 */
export function libraryDeleteSkill(skillId: string): Effect.Effect<void, AppError> {
	return tauriClient.skills.libraryDeleteSkill(skillId);
}

/**
 * Get sync targets for a skill.
 */
export function libraryGetSyncTargets(skillId: string): Effect.Effect<SyncTarget[], AppError> {
	return tauriClient.skills.libraryGetSyncTargets(skillId);
}

/**
 * Set sync target enabled/disabled for a skill.
 */
export function librarySetSyncTarget(
	skillId: string,
	agentId: string,
	enabled: boolean
): Effect.Effect<void, AppError> {
	return tauriClient.skills.librarySetSyncTarget(skillId, agentId, enabled);
}

/**
 * Sync a single skill to all enabled agents.
 */
export function librarySyncSkill(
	skillId: string
): Effect.Effect<import("../types/sync-result.js").SkillSyncResult[], AppError> {
	return tauriClient.skills.librarySyncSkill(skillId);
}

/**
 * Sync all skills to all enabled agents.
 */
export function librarySyncAll(): Effect.Effect<SyncResult, AppError> {
	return tauriClient.skills.librarySyncAll();
}

/**
 * Check if the library is empty (first run detection).
 */
export function libraryIsEmpty(): Effect.Effect<boolean, AppError> {
	return tauriClient.skills.libraryIsEmpty();
}

/**
 * Import existing skills from agent directories into the library.
 */
export function libraryImportExisting(): Effect.Effect<LibrarySkill[], AppError> {
	return tauriClient.skills.libraryImportExisting();
}

/**
 * Get the skill folder path for a specific agent.
 */
export function libraryGetSkillFolderPath(
	agentId: string,
	skillName: string
): Effect.Effect<string | null, AppError> {
	return tauriClient.skills.libraryGetSkillFolderPath(agentId, skillName);
}

/**
 * Delete skill files from specified agent directories.
 */
export function libraryDeleteSkillFromAgents(
	skillName: string,
	agentIds: string[]
): Effect.Effect<import("../types/sync-result.js").SkillSyncResult[], AppError> {
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
