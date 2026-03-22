/**
 * Library Store - Reactive state management for the Unified Skills Library.
 *
 * Uses Svelte 5 runes for reactive state and neverthrow ResultAsync
 * for error handling.
 *
 * Design: No explicit "save" - edits are written directly to the database
 * with debouncing. Sync is a separate action that pushes skills to enabled
 * agent directories.
 */

import { okAsync, ResultAsync } from "neverthrow";
import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { AppError } from "../../acp/errors/app-error.js";
import { formatTimeAgo } from "../../acp/logic/thread-list-date-utils.js";
import { createLogger } from "../../acp/utils/logger.js";
import { libraryApi, pluginSkillsApi } from "../api/skills-api.js";
import type {
	LibrarySkill,
	LibrarySkillWithSync,
	PluginInfo,
	PluginSkill,
	SyncResult,
	SyncTarget,
} from "../types/index.js";

const logger = createLogger({ id: "library-store", name: "LibraryStore" });

const LIBRARY_STORE_KEY = Symbol("library-store");

/** Debounce delay for auto-save in milliseconds */
const AUTO_SAVE_DELAY = 800;

export class LibraryStore {
	// === PRIMARY STATE ===
	/** All skills with their sync status */
	skills = $state<LibrarySkillWithSync[]>([]);

	/** Currently selected skill */
	selectedSkill = $state<LibrarySkillWithSync | null>(null);

	/** Loading state */
	loading = $state(false);

	/** Syncing state */
	syncing = $state(false);

	/** Error message if any */
	error = $state<string | null>(null);

	/** Whether this is the first run (no skills in library) */
	isFirstRun = $state<boolean | null>(null);

	// === PLUGIN STATE ===
	/** Discovered plugins with skills */
	plugins = $state<PluginInfo[]>([]);

	/** Skills from all plugins, keyed by plugin ID */
	pluginSkills = new SvelteMap<string, PluginSkill[]>();

	/** Currently selected plugin skill (for preview) */
	selectedPluginSkill = $state<PluginSkill | null>(null);

	/** Loading state for plugins */
	loadingPlugins = $state(false);

	// === EDITOR STATE ===
	/** Current editor content */
	editorContent = $state("");

	/** Whether currently saving (for UI feedback) */
	isSaving = $state(false);

	/** Debounce timer for auto-save */
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	/** View mode for editor/preview */
	viewMode = $state<"split" | "split-vertical" | "editor" | "preview">("split");

	// === DERIVED STATE ===
	/** Selected skill ID for easy access */
	readonly selectedSkillId = $derived(this.selectedSkill?.skill.id ?? null);

	/** Count of skills with pending sync */
	readonly pendingCount = $derived(this.skills.filter((s) => s.hasPendingChanges).length);

	/** All available agents from sync targets */
	readonly availableAgents = $derived.by(() => {
		// If we have a selected skill, use its sync targets
		if (this.selectedSkill) {
			return this.selectedSkill.syncTargets.map((t) => ({
				id: t.agentId,
				name: t.agentName,
				enabled: t.enabled,
				status: t.status,
				syncedAt: t.syncedAt,
			}));
		}
		// Fall back to collecting from all skills
		const agents = new Map<string, SyncTarget>();
		for (const skill of this.skills) {
			for (const target of skill.syncTargets) {
				if (!agents.has(target.agentId)) {
					agents.set(target.agentId, target);
				}
			}
		}
		return Array.from(agents.values())
			.map((t) => ({
				id: t.agentId,
				name: t.agentName,
				enabled: t.enabled,
				status: t.status,
				syncedAt: t.syncedAt,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	// ============================================
	// INITIALIZATION
	// ============================================

	/**
	 * Initialize the library store.
	 * Checks if this is first run and loads skills.
	 */
	initialize(): ResultAsync<void, AppError> {
		this.loading = true;
		this.error = null;

		logger.debug("Initializing library store");

		// Load plugins in parallel with library check
		this.loadPlugins();

		return libraryApi
			.isEmpty()
			.andThen((isEmpty) => {
				if (isEmpty) {
					logger.debug("First run detected - auto-importing skills from agent directories");
					return this.importExisting().andThen(() => this.loadSkills());
				}

				this.isFirstRun = false;
				return this.loadSkills();
			})
			.mapErr((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to initialize library", err);
				return err;
			});
	}

	/**
	 * Import existing skills from agent directories.
	 */
	importExisting(): ResultAsync<LibrarySkill[], AppError> {
		this.loading = true;
		this.error = null;

		logger.debug("Importing existing skills");

		return libraryApi
			.importExisting()
			.andThen((imported) => {
				this.isFirstRun = false;
				logger.debug("Imported skills", { count: imported.length });
				return this.loadSkills().map(() => imported);
			})
			.mapErr((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to import existing skills", err);
				return err;
			});
	}

	// ============================================
	// SKILL LIST OPERATIONS
	// ============================================

	/**
	 * Load all skills with sync status.
	 */
	loadSkills(): ResultAsync<void, AppError> {
		this.loading = true;
		this.error = null;

		logger.debug("Loading skills");

		return libraryApi
			.listSkillsWithSync()
			.map((skills) => {
				this.skills = skills;
				this.loading = false;
				logger.debug("Skills loaded", { count: skills.length });
			})
			.mapErr((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to load skills", err);
				return err;
			});
	}

	// ============================================
	// SKILL SELECTION
	// ============================================

	/**
	 * Select a skill and load its content.
	 */
	selectSkill(skillId: string): ResultAsync<void, AppError> {
		// Cancel any pending auto-save
		this.cancelPendingSave();

		this.loading = true;

		return libraryApi
			.getSkill(skillId)
			.map((skill) => {
				this.selectedSkill = skill;
				this.editorContent = skill.skill.content;
				this.loading = false;
				logger.debug("Skill selected", { skillId, name: skill.skill.name });
			})
			.mapErr((err) => {
				this.loading = false;
				this.error = err.message;
				logger.error("Failed to select skill", { skillId, error: err });
				return err;
			});
	}

	/**
	 * Clear the current selection.
	 */
	clearSelection(): void {
		this.cancelPendingSave();
		this.selectedSkill = null;
		this.editorContent = "";
	}
	/**
	 * Select the first skill in the library automatically.
	 * Used for initializing the UI with a default selection.
	 */
	selectFirstSkill(): ResultAsync<void, AppError> {
		if (this.skills.length === 0) {
			logger.debug("No skills available to select first skill");
			return okAsync(undefined);
		}

		const firstSkillId = this.skills[0].skill.id;
		logger.debug("Auto-selecting first skill", { skillId: firstSkillId });
		return this.selectSkill(firstSkillId);
	}

	/**
	 * Get the pending sync count for a skill.
	 * Returns the number of enabled agents that are waiting for sync.
	 */
	getSkillPendingCount(skill: LibrarySkillWithSync): number {
		return skill.syncTargets.filter(
			(t) => t.enabled && (t.status === "pending" || t.status === "never")
		).length;
	}

	/**
	 * Get the last sync time for a skill as a formatted string.
	 * Returns a human-readable relative time (e.g., "5m ago", "2h ago").
	 * Returns "Never" if skill has never been synced.
	 */
	getSkillLastSyncTime(skill: LibrarySkillWithSync): string {
		// Find the most recent sync timestamp from synced targets
		const syncedTargets = skill.syncTargets.filter((t) => t.status === "synced");
		if (syncedTargets.length === 0) {
			return "Never";
		}

		// Get the most recent syncedAt timestamp
		const latestSyncedAt = Math.max(
			...syncedTargets.filter((t) => t.syncedAt !== null).map((t) => t.syncedAt as number)
		);

		if (!Number.isFinite(latestSyncedAt)) {
			return "Never";
		}

		// Format using the existing date utility
		const date = new Date(latestSyncedAt);
		const result = formatTimeAgo(date);
		return result.isOk() ? `Synced ${result.value}` : "Never";
	}

	// ============================================
	// EDITOR OPERATIONS
	// ============================================

	/**
	 * Update the editor content and auto-save to database.
	 * Uses debouncing to avoid excessive writes.
	 */
	setEditorContent(content: string): void {
		this.editorContent = content;

		// Skip if no skill selected or content hasn't changed
		if (!this.selectedSkill || content === this.selectedSkill.skill.content) {
			return;
		}

		// Schedule auto-save with debounce
		this.scheduleSave();
	}

	/**
	 * Cancel any pending auto-save.
	 */
	private cancelPendingSave(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	/**
	 * Schedule an auto-save with debouncing.
	 */
	private scheduleSave(): void {
		this.cancelPendingSave();

		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.persistContent();
		}, AUTO_SAVE_DELAY);
	}

	/**
	 * Persist current editor content to database.
	 */
	private persistContent(): void {
		if (!this.selectedSkill) return;

		const skillId = this.selectedSkill.skill.id;
		const content = this.editorContent;

		// Skip if content matches what's in the skill
		if (content === this.selectedSkill.skill.content) return;

		this.isSaving = true;
		logger.debug("Auto-saving skill", { skillId });

		libraryApi
			.updateSkill(skillId, undefined, undefined, content, undefined)
			.andThen(() => libraryApi.getSkill(skillId))
			.map((updatedSkill) => {
				// Only update if still viewing the same skill
				if (this.selectedSkill?.skill.id === skillId) {
					this.selectedSkill = updatedSkill;
				}

				// Update in skills list
				const index = this.skills.findIndex((s) => s.skill.id === skillId);
				if (index >= 0) {
					this.skills[index] = updatedSkill;
				}

				this.isSaving = false;
				logger.debug("Skill auto-saved", { skillId });
			})
			.mapErr((err) => {
				this.isSaving = false;
				this.error = err.message;
				logger.error("Failed to auto-save skill", { skillId, error: err });
			});
	}

	// ============================================
	// CRUD OPERATIONS
	// ============================================

	/**
	 * Create a new skill.
	 */
	createSkill(
		name: string,
		description: string | null,
		content: string,
		category: string | null
	): ResultAsync<LibrarySkill, AppError> {
		logger.debug("Creating skill", { name });

		return libraryApi
			.createSkill(name, description, content, category)
			.map((skill) => {
				this.loadSkills();
				logger.debug("Skill created", { skillId: skill.id });
				return skill;
			})
			.mapErr((err) => {
				this.error = err.message;
				logger.error("Failed to create skill", { name, error: err });
				return err;
			});
	}

	/**
	 * Delete a skill.
	 */
	deleteSkill(skillId: string): ResultAsync<void, AppError> {
		logger.debug("Deleting skill", { skillId });

		return libraryApi
			.deleteSkill(skillId)
			.map(() => {
				if (this.selectedSkill?.skill.id === skillId) {
					this.clearSelection();
				}
				this.loadSkills();
				logger.debug("Skill deleted", { skillId });
			})
			.mapErr((err) => {
				this.error = err.message;
				logger.error("Failed to delete skill", { skillId, error: err });
				return err;
			});
	}

	// ============================================
	// PLUGIN OPERATIONS
	// ============================================

	/**
	 * Load all plugins with skills.
	 */
	loadPlugins(): ResultAsync<void, AppError> {
		this.loadingPlugins = true;

		logger.debug("Loading plugins");

		return pluginSkillsApi
			.listPlugins()
			.map((plugins) => {
				this.plugins = plugins;
				this.loadingPlugins = false;
				logger.debug("Plugins loaded", { count: plugins.length });

				// Load skills for each plugin
				this.loadAllPluginSkills();
			})
			.mapErr((err) => {
				this.loadingPlugins = false;
				logger.error("Failed to load plugins", err);
				return err;
			});
	}

	/**
	 * Load skills for all plugins.
	 */
	private loadAllPluginSkills(): void {
		for (const plugin of this.plugins) {
			this.loadPluginSkillsForPlugin(plugin.id);
		}
	}

	/**
	 * Load skills for a specific plugin.
	 */
	loadPluginSkillsForPlugin(pluginId: string): ResultAsync<PluginSkill[], AppError> {
		const plugin = this.plugins.find((p) => p.id === pluginId);
		if (!plugin) {
			return okAsync([]);
		}

		// Check if already loaded
		if (this.pluginSkills.has(pluginId)) {
			return okAsync(this.pluginSkills.get(pluginId) ?? []);
		}

		logger.debug("Loading skills for plugin", { pluginId });

		return pluginSkillsApi
			.listPluginSkills(pluginId)
			.map((skills) => {
				// SvelteMap handles reactivity automatically
				this.pluginSkills.set(pluginId, skills);
				logger.debug("Plugin skills loaded", { pluginId, count: skills.length });
				return skills;
			})
			.mapErr((err) => {
				logger.error("Failed to load plugin skills", { pluginId, error: err });
				return err;
			});
	}

	/**
	 * Select a plugin skill for preview (read-only).
	 */
	selectPluginSkill(skillId: string): ResultAsync<void, AppError> {
		// Clear library selection when viewing plugin skill
		this.cancelPendingSave();
		this.selectedSkill = null;

		logger.debug("Selecting plugin skill", { skillId });

		return pluginSkillsApi
			.getPluginSkill(skillId)
			.map((skill) => {
				this.selectedPluginSkill = skill;
				this.editorContent = skill.content;
				logger.debug("Plugin skill selected", { skillId, name: skill.name });
			})
			.mapErr((err) => {
				this.error = err.message;
				logger.error("Failed to select plugin skill", { skillId, error: err });
				return err;
			});
	}

	/**
	 * Copy a plugin skill to the library.
	 */
	copyPluginSkillToLibrary(skillId: string): ResultAsync<LibrarySkill, AppError> {
		if (!this.selectedPluginSkill) {
			return ResultAsync.fromPromise(
				Promise.reject(new Error("No plugin skill selected")),
				(e) => e as AppError
			);
		}

		const skill = this.selectedPluginSkill;
		logger.debug("Copying plugin skill to library", { skillId, name: skill.name });

		return libraryApi
			.createSkill(skill.name, skill.description, skill.content, null)
			.map((newSkill) => {
				// Clear plugin selection
				this.selectedPluginSkill = null;

				// Reload library skills
				this.loadSkills();

				// Select the new skill
				this.selectSkill(newSkill.id);

				logger.debug("Plugin skill copied to library", { newSkillId: newSkill.id });
				return newSkill;
			})
			.mapErr((err) => {
				this.error = err.message;
				logger.error("Failed to copy plugin skill to library", { skillId, error: err });
				return err;
			});
	}

	/**
	 * Clear plugin skill selection.
	 */
	clearPluginSelection(): void {
		this.selectedPluginSkill = null;
	}

	// ============================================
	// SYNC OPERATIONS
	// ============================================

	/**
	 * Set sync target enabled/disabled for a skill.
	 */
	setSyncTarget(skillId: string, agentId: string, enabled: boolean): ResultAsync<void, AppError> {
		logger.debug("Setting sync target", { skillId, agentId, enabled });

		return libraryApi
			.setSyncTarget(skillId, agentId, enabled)
			.andThen(() => {
				// Reload the skill to get updated sync status
				if (this.selectedSkill?.skill.id === skillId) {
					return libraryApi.getSkill(skillId).map((skill) => {
						this.selectedSkill = skill;

						// Update in skills list
						const index = this.skills.findIndex((s) => s.skill.id === skillId);
						if (index >= 0) {
							this.skills[index] = skill;
						}
					});
				}
				return okAsync(undefined);
			})
			.mapErr((err) => {
				this.error = err.message;
				logger.error("Failed to set sync target", { skillId, agentId, error: err });
				return err;
			});
	}

	/**
	 * Sync a single skill to all enabled agents.
	 */
	syncSkill(skillId: string): ResultAsync<void, AppError> {
		this.syncing = true;

		logger.debug("Syncing skill", { skillId });

		return libraryApi
			.syncSkill(skillId)
			.andThen((results) => {
				const failed = results.filter((r) => !r.success);
				if (failed.length > 0) {
					logger.warn("Some sync targets failed", { failed });
				}

				// Reload to get updated sync status
				return this.loadSkills().map(() => {
					// Re-select if this was selected
					if (this.selectedSkill?.skill.id === skillId) {
						this.selectSkill(skillId);
					}
				});
			})
			.map(() => {
				this.syncing = false;
				logger.debug("Skill synced", { skillId });
			})
			.mapErr((err) => {
				this.syncing = false;
				this.error = err.message;
				logger.error("Failed to sync skill", { skillId, error: err });
				return err;
			});
	}

	/**
	 * Sync all skills to all enabled agents.
	 */
	syncAll(): ResultAsync<SyncResult, AppError> {
		this.syncing = true;

		logger.debug("Syncing all skills");

		return libraryApi
			.syncAll()
			.andThen((result) => {
				// Reload to get updated sync status
				return this.loadSkills().map(() => result);
			})
			.map((result) => {
				this.syncing = false;
				logger.debug("All skills synced", {
					synced: result.syncedCount,
					failed: result.failedCount,
				});
				return result;
			})
			.mapErr((err) => {
				this.syncing = false;
				this.error = err.message;
				logger.error("Failed to sync all skills", err);
				return err;
			});
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
 * Create and set the library store in Svelte context.
 */
export function createLibraryStore(): LibraryStore {
	const store = new LibraryStore();
	setContext(LIBRARY_STORE_KEY, store);
	return store;
}

/**
 * Get the library store from Svelte context.
 */
export function getLibraryStore(): LibraryStore {
	return getContext<LibraryStore>(LIBRARY_STORE_KEY);
}
