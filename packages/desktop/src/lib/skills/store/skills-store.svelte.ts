/**
 * Skills Store - Reactive state management for the Skills Manager.
 *
 * Uses Svelte 5 runes for reactive state and Effect
 * for error handling.
 */

import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
import { getContext, setContext } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import type { AppError } from "../../acp/errors/app-error.js";
import { AgentError } from "../../acp/errors/app-error.js";
import { createLogger } from "../../acp/utils/logger.js";

import { copyPluginSkillToAgent, getPluginSkill, skillsApi } from "../api/skills-api.js";
import type { PluginSkill, Skill, SkillsChangedEvent, SkillTreeNode } from "../types/index.js";

const logger = createLogger({ id: "skills-store", name: "SkillsStore" });

const SKILLS_STORE_KEY = Symbol("skills-store");

export class SkillsStore {
	// === PRIMARY STATE ===
	/** Tree structure of agents and their skills */
	tree = $state<SkillTreeNode[]>([]);

	/** Currently selected skill (full data) */
	selectedSkill = $state<Skill | null>(null);

	/** Currently selected plugin skill (read-only) */
	selectedPluginSkill = $state<PluginSkill | null>(null);

	/** Loading state */
	loading = $state(false);

	/** Error message if any */
	error = $state<string | null>(null);

	// === EDITOR STATE ===
	/** Current editor content */
	editorContent = $state("");

	/** Whether there are unsaved changes */
	isDirty = $state(false);

	/** Whether currently saving */
	isSaving = $state(false);

	// === UI STATE ===
	/** Set of expanded node IDs */
	expandedNodes = $state(new SvelteSet<string>());

	// === FILE WATCHER ===
	private watcherCleanup: (() => void) | null = null;

	// === DERIVED STATE ===
	/** Selected skill ID for easy access (either regular or plugin skill) */
	readonly selectedSkillId = $derived(
		this.selectedSkill?.id ?? this.selectedPluginSkill?.id ?? null
	);

	/** Whether the selected item is a plugin skill (read-only) */
	readonly isPluginSkillSelected = $derived(this.selectedPluginSkill !== null);

	/** Get agents from tree (top-level nodes) */
	readonly agents = $derived(this.tree.filter((node) => node.nodeType === "agent"));

	// ============================================
	// TREE OPERATIONS
	// ============================================

	/**
	 * Load the tree structure of all agents and skills.
	 */
	loadTree(): Effect.Effect<void, AppError> {
		this.loading = true;
		this.error = null;

		logger.debug("Loading skills tree");

		return skillsApi.listTree().pipe(
			Effect.map((nodes) => {
				this.tree = nodes;
				this.loading = false;

				// Auto-expand all agent nodes and plugins section
				const newExpanded = new SvelteSet<string>();
				for (const node of nodes) {
					if (node.nodeType === "agent" || node.nodeType === "plugins-section") {
						newExpanded.add(node.id);
					}
					// Also expand individual plugins
					if (node.nodeType === "plugins-section") {
						for (const plugin of node.children) {
							newExpanded.add(plugin.id);
						}
					}
				}
				this.expandedNodes = newExpanded;

				logger.debug("Skills tree loaded", { agentCount: nodes.length });
			}),
			Effect.mapError((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to load skills tree", err);
				return err;
			})
		);
	}

	/**
	 * Toggle expansion state of a node.
	 */
	toggleNode(nodeId: string): void {
		if (this.expandedNodes.has(nodeId)) {
			this.expandedNodes.delete(nodeId);
		} else {
			this.expandedNodes.add(nodeId);
		}
	}

	/**
	 * Check if a node is expanded.
	 */
	isExpanded(nodeId: string): boolean {
		return this.expandedNodes.has(nodeId);
	}

	// ============================================
	// SKILL SELECTION
	// ============================================

	/**
	 * Select a skill and load its content.
	 */
	selectSkill(skillId: string): Effect.Effect<void, AppError> {
		// Check for unsaved changes
		if (this.isDirty) {
			logger.warn("Selecting new skill with unsaved changes", {
				currentSkillId: this.selectedSkillId,
				newSkillId: skillId,
			});
			// Could show confirmation dialog here
		}

		this.loading = true;

		return skillsApi.getSkill(skillId).pipe(
			Effect.map((skill) => {
				// Clear plugin skill selection
				this.selectedPluginSkill = null;
				this.selectedSkill = skill;
				this.editorContent = skill.content;
				this.isDirty = false;
				this.loading = false;
				logger.debug("Skill selected", { skillId, name: skill.name });
			}),
			Effect.mapError((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to select skill", { skillId, error: err });
				return err;
			})
		);
	}

	/**
	 * Clear the current selection.
	 */
	clearSelection(): void {
		this.selectedSkill = null;
		this.selectedPluginSkill = null;
		this.editorContent = "";
		this.isDirty = false;
	}

	/**
	 * Select a plugin skill (read-only).
	 */
	selectPluginSkill(skillId: string): Effect.Effect<void, AppError> {
		// Check for unsaved changes
		if (this.isDirty) {
			logger.warn("Selecting plugin skill with unsaved changes", {
				currentSkillId: this.selectedSkillId,
				newSkillId: skillId,
			});
		}

		this.loading = true;

		return getPluginSkill(skillId).pipe(
			Effect.map((skill) => {
				// Clear regular skill selection
				this.selectedSkill = null;
				this.selectedPluginSkill = skill;
				this.editorContent = skill.content;
				this.isDirty = false;
				this.loading = false;
				logger.debug("Plugin skill selected", { skillId, name: skill.name });
			}),
			Effect.mapError((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to select plugin skill", { skillId, error: err });
				return err;
			})
		);
	}

	/**
	 * Copy a plugin skill to an agent directory.
	 */
	copyPluginSkillToAgent(skillId: string, targetAgentId: string): Effect.Effect<Skill, AppError> {
		logger.debug("Copying plugin skill to agent", { skillId, targetAgentId });

		return copyPluginSkillToAgent(skillId, targetAgentId).pipe(
			Effect.map((newSkill) => {
				// Refresh tree to show new skill
				void Effect.runPromise(Effect.result(this.loadTree()));
				logger.debug("Plugin skill copied", { skillId, newSkillId: newSkill.id });
				return newSkill;
			}),
			Effect.mapError((err) => {
				this.error = err.message;
				logger.error("Failed to copy plugin skill", { skillId, targetAgentId, error: err });
				return err;
			})
		);
	}

	// ============================================
	// EDITOR OPERATIONS
	// ============================================

	/**
	 * Update the editor content.
	 */
	setEditorContent(content: string): void {
		this.editorContent = content;
		this.isDirty = this.selectedSkill !== null && content !== this.selectedSkill.content;
	}

	/**
	 * Save the current skill.
	 */
	saveSkill(): Effect.Effect<void, AppError> {
		if (!this.selectedSkill || !this.isDirty) {
			return Effect.succeed(undefined);
		}

		this.isSaving = true;
		const skillId = this.selectedSkill.id;

		logger.debug("Saving skill", { skillId });

		return skillsApi.updateSkill(skillId, this.editorContent).pipe(
			Effect.map((updatedSkill) => {
				this.selectedSkill = updatedSkill;
				this.isDirty = false;
				this.isSaving = false;
				logger.debug("Skill saved", { skillId });
			}),
			Effect.mapError((err) => {
				this.isSaving = false;
				this.error = err.message;
				logger.error("Failed to save skill", { skillId, error: err });
				return err;
			})
		);
	}

	// ============================================
	// CRUD OPERATIONS
	// ============================================

	/**
	 * Create a new skill.
	 */
	createSkill(
		agentId: string,
		folderName: string,
		name: string,
		description: string
	): Effect.Effect<Skill, AppError> {
		logger.debug("Creating skill", { agentId, folderName, name });

		return skillsApi.createSkill(agentId, folderName, name, description).pipe(
			Effect.map((skill) => {
				// Refresh tree to show new skill
				void Effect.runPromise(Effect.result(this.loadTree()));
				logger.debug("Skill created", { skillId: skill.id });
				return skill;
			}),
			Effect.mapError((err) => {
				this.error = err.message;
				logger.error("Failed to create skill", { agentId, folderName, error: err });
				return err;
			})
		);
	}

	/**
	 * Delete a skill.
	 */
	deleteSkill(skillId: string): Effect.Effect<void, AppError> {
		logger.debug("Deleting skill", { skillId });

		return skillsApi.deleteSkill(skillId).pipe(
			Effect.map(() => {
				// Clear selection if this was the selected skill
				if (this.selectedSkill?.id === skillId) {
					this.clearSelection();
				}
				// Refresh tree
				void Effect.runPromise(Effect.result(this.loadTree()));
				logger.debug("Skill deleted", { skillId });
			}),
			Effect.mapError((err) => {
				this.error = err.message;
				logger.error("Failed to delete skill", { skillId, error: err });
				return err;
			})
		);
	}

	/**
	 * Copy a skill to another agent.
	 */
	copySkillTo(
		skillId: string,
		targetAgentId: string,
		newFolderName?: string
	): Effect.Effect<Skill, AppError> {
		logger.debug("Copying skill", { skillId, targetAgentId, newFolderName });

		return skillsApi.copySkillTo(skillId, targetAgentId, newFolderName).pipe(
			Effect.map((newSkill) => {
				// Refresh tree to show new skill
				void Effect.runPromise(Effect.result(this.loadTree()));
				logger.debug("Skill copied", { skillId, newSkillId: newSkill.id });
				return newSkill;
			}),
			Effect.mapError((err) => {
				this.error = err.message;
				logger.error("Failed to copy skill", { skillId, targetAgentId, error: err });
				return err;
			})
		);
	}

	// ============================================
	// FILE WATCHING
	// ============================================

	/**
	 * Initialize file watching for skill changes.
	 */
	initializeWatcher(): Effect.Effect<void, AppError> {
		return skillsApi.startWatching().pipe(
			Effect.flatMap(() =>
				fromPromise(
					() =>
						skillsApi.onSkillsChanged((event) => {
							this.handleSkillsChanged(event);
						}),
					(error) =>
						new AgentError(
							"on_skills_changed",
							error instanceof Error ? error : new Error(String(error))
						)
				)
			),
			Effect.map((cleanup) => {
				this.watcherCleanup = cleanup;
				logger.debug("File watcher initialized");
			}),
			Effect.mapError((err) => {
				logger.error("Failed to initialize file watcher", err);
				return err;
			})
		);
	}

	/**
	 * Handle file change events from the watcher.
	 */
	private handleSkillsChanged(event: SkillsChangedEvent): void {
		logger.debug("Skills changed", event);

		// Refresh tree on any change
		void Effect.runPromise(Effect.result(this.loadTree()));

		// If currently selected skill was modified externally, reload it
		if (this.selectedSkill) {
			if (event.path.includes(this.selectedSkill.folderName)) {
				if (event.changeType === "deleted") {
					logger.debug("Selected skill was deleted, clearing selection");
					this.clearSelection();
				} else if (event.changeType === "modified" && !this.isDirty) {
					logger.debug("Selected skill was modified externally, reloading");
					void Effect.runPromise(Effect.result(this.selectSkill(this.selectedSkill.id)));
				}
			}
		}
	}

	/**
	 * Cleanup resources.
	 */
	cleanup(): void {
		if (this.watcherCleanup) {
			this.watcherCleanup();
			this.watcherCleanup = null;
		}
		void Effect.runPromise(Effect.result(skillsApi.stopWatching()));
		logger.debug("Skills store cleaned up");
	}

	// ============================================
	// UTILITY
	// ============================================

	/**
	 * Clear any error message.
	 */
	clearError(): void {
		this.error = null;
	}
}

/**
 * Create and set the skills store in Svelte context.
 */
export function createSkillsStore(): SkillsStore {
	const store = new SkillsStore();
	setContext(SKILLS_STORE_KEY, store);
	return store;
}

/**
 * Get the skills store from Svelte context.
 */
export function getSkillsStore(): SkillsStore {
	return getContext<SkillsStore>(SKILLS_STORE_KEY);
}
