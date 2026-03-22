/**
 * Keybindings Service - Main entry point for the keybinding system.
 *
 * This service orchestrates the action registry, keybinding registry,
 * and context manager to provide a unified keybinding system.
 */

import { err, errAsync, ok, type Result, type ResultAsync } from "neverthrow";
import type { CustomKeybindings } from "$lib/services/settings.svelte.js";
import * as settingsService from "$lib/services/settings.svelte.js";
import { type ActionRegistry, createActionRegistry } from "./actions/registry.js";
import { DEFAULT_KEYBINDINGS } from "./bindings/defaults.js";
import { createKeybindingRegistry, type KeybindingRegistry } from "./bindings/registry.svelte.js";
import { type ContextManager, createContextManager } from "./context/manager.svelte.js";
import type { Action, Keybinding, KeybindingConflict } from "./types.js";
import { KeybindingError } from "./types.js";
import { formatKeyString, formatKeyStringToArray } from "./utils/formatter.js";

/**
 * Keybindings Service - Unified interface for the keybinding system.
 */
export class KeybindingsService {
	readonly actions: ActionRegistry;
	readonly bindings: KeybindingRegistry;
	readonly context: ContextManager;

	private installed = $state(false);
	private target: Window | HTMLElement | null = null;
	/** User keybindings stored as command -> key map */
	private userKeybindings: CustomKeybindings = $state({});

	constructor() {
		this.actions = createActionRegistry();
		this.bindings = createKeybindingRegistry();
		this.context = createContextManager();
	}

	/**
	 * Initialize the keybinding system with default bindings.
	 */
	initialize(): Result<void, KeybindingError> {
		// Register default keybindings
		this.bindings.upsertMany(DEFAULT_KEYBINDINGS);
		return ok(undefined);
	}

	/**
	 * Load user keybindings from database and merge with defaults.
	 */
	loadUserKeybindings(): ResultAsync<void, KeybindingError> {
		return settingsService
			.getCustomKeybindings()
			.mapErr(
				(e) =>
					new KeybindingError("INSTALL_FAILED", `Failed to load user keybindings: ${e.message}`)
			)
			.map((customKeybindings) => {
				// Filter out any invalid entries (empty keys or values)
				const validKeybindings: Record<string, string> = {};
				for (const [command, key] of Object.entries(customKeybindings)) {
					if (command && key && typeof key === "string" && key.trim() !== "") {
						validKeybindings[command] = key;
					}
				}
				// Store locally
				this.userKeybindings = validKeybindings;
				// Convert to Keybinding[] and merge with defaults
				const bindings: Keybinding[] = Object.entries(validKeybindings).map(([command, key]) => ({
					key,
					command,
					source: "user" as const,
				}));
				// User keybindings override defaults
				this.bindings.upsertMany(bindings);
			});
	}

	/**
	 * Save a user keybinding to the database and update the registry.
	 */
	saveUserKeybinding(binding: Keybinding): ResultAsync<void, KeybindingError> {
		// Update registry immediately
		this.bindings.upsert({ ...binding, source: "user" });

		// Update local store
		this.userKeybindings = {
			...this.userKeybindings,
			[binding.command]: binding.key,
		};

		// Reinstall if already installed
		if (this.installed && this.target) {
			const reinstallResult = this.reinstall();
			if (reinstallResult.isErr()) {
				return errAsync(reinstallResult.error);
			}
		}

		// Save all user keybindings to database
		return settingsService
			.saveCustomKeybindings(this.userKeybindings)
			.mapErr(
				(e) => new KeybindingError("INSTALL_FAILED", `Failed to save user keybinding: ${e.message}`)
			);
	}

	/**
	 * Delete a user keybinding and restore the default.
	 */
	deleteUserKeybinding(command: string): ResultAsync<void, KeybindingError> {
		// Remove from local store
		const { [command]: _, ...rest } = this.userKeybindings;
		this.userKeybindings = rest;

		// Find default binding for this command
		const defaultBinding = DEFAULT_KEYBINDINGS.find((b) => b.command === command);
		if (defaultBinding) {
			// Restore default in registry
			this.bindings.upsert({ ...defaultBinding, source: "default" });
		}

		// Reinstall if already installed
		if (this.installed && this.target) {
			const reinstallResult = this.reinstall();
			if (reinstallResult.isErr()) {
				return errAsync(reinstallResult.error);
			}
		}

		// Save updated user keybindings to database
		return settingsService
			.saveCustomKeybindings(this.userKeybindings)
			.mapErr(
				(e) =>
					new KeybindingError("INSTALL_FAILED", `Failed to delete user keybinding: ${e.message}`)
			);
	}

	/**
	 * Check if a command has a user keybinding.
	 */
	hasUserKeybinding(command: string): boolean {
		const key = this.userKeybindings[command];
		return key !== undefined && key !== null && key !== "";
	}

	/**
	 * Get all user keybindings.
	 */
	getUserKeybindings(): CustomKeybindings {
		return this.userKeybindings;
	}

	/**
	 * Register an action.
	 */
	registerAction(action: Action): Result<void, KeybindingError> {
		return this.actions.register(action);
	}

	/**
	 * Register multiple actions.
	 */
	registerActions(actions: Action[]): Result<void, KeybindingError> {
		return this.actions.registerMany(actions);
	}

	/**
	 * Register or update an action.
	 */
	upsertAction(action: Action): void {
		this.actions.upsert(action);
	}

	/**
	 * Register or update multiple actions.
	 */
	upsertActions(actions: Action[]): void {
		this.actions.upsertMany(actions);
	}

	/**
	 * Register a keybinding.
	 */
	registerKeybinding(binding: Keybinding): Result<void, KeybindingError> {
		const result = this.bindings.register(binding);
		if (result.isOk() && this.installed && this.target) {
			return this.bindings.reinstall(this.target);
		}
		return result;
	}

	/**
	 * Register multiple keybindings.
	 */
	registerKeybindings(bindings: Keybinding[]): Result<void, KeybindingError> {
		const result = this.bindings.registerMany(bindings);
		if (result.isOk() && this.installed && this.target) {
			return this.bindings.reinstall(this.target);
		}
		return result;
	}

	/**
	 * Set a context value.
	 */
	setContext(key: string, value: boolean | string | number): void {
		this.context.set(key, value);
	}

	/**
	 * Set multiple context values.
	 */
	setContextMany(entries: Record<string, boolean | string | number>): void {
		this.context.setMany(entries);
	}

	/**
	 * Get a context value.
	 */
	getContext(key: string): boolean | string | number | undefined {
		return this.context.get(key);
	}

	/**
	 * Install keybindings on a target element.
	 */
	install(target: Window | HTMLElement): Result<void, KeybindingError> {
		this.target = target;
		const result = this.bindings.install(target, this.actions, this.context);
		if (result.isOk()) {
			this.installed = true;
		}
		return result;
	}

	/**
	 * Reinstall keybindings (after changes).
	 */
	reinstall(): Result<void, KeybindingError> {
		if (!this.target) {
			return err(new KeybindingError("INSTALL_FAILED", "Cannot reinstall - no target set"));
		}
		return this.bindings.reinstall(this.target);
	}

	/**
	 * Uninstall keybindings.
	 */
	uninstall(): void {
		this.bindings.uninstall();
		this.installed = false;
	}

	/**
	 * Check if keybindings are installed.
	 */
	isInstalled(): boolean {
		return this.installed;
	}

	/**
	 * Execute an action by ID.
	 */
	executeAction(actionId: string): ResultAsync<void, KeybindingError> {
		return this.actions.execute(actionId, this.context);
	}

	/**
	 * Check if an action is available in the current context.
	 */
	isActionAvailable(actionId: string): boolean {
		return this.actions.isAvailable(actionId, this.context);
	}

	/**
	 * Get all actions.
	 */
	getAllActions(): Action[] {
		return this.actions.getAll();
	}

	/**
	 * Get all keybindings.
	 */
	getAllKeybindings(): Keybinding[] {
		return this.bindings.getAll();
	}

	/**
	 * Get keybindings for a specific action.
	 */
	getKeybindingsForAction(actionId: string): Keybinding[] {
		return this.bindings.getForCommand(actionId);
	}

	/**
	 * Get the primary keybinding for an action.
	 */
	getPrimaryKeybinding(actionId: string): Keybinding | undefined {
		return this.bindings.getPrimaryForCommand(actionId);
	}

	/**
	 * Get the formatted shortcut string for an action.
	 * This method is reactive - it will trigger updates when keybinds change.
	 */
	getShortcutString(actionId: string): string | undefined {
		// Read version to create reactive dependency
		this.bindings.getVersion();
		const binding = this.getPrimaryKeybinding(actionId);
		return binding ? formatKeyString(binding.key) : undefined;
	}

	/**
	 * Get the shortcut as an array of key symbols for an action.
	 * This method is reactive - it will trigger updates when keybinds change.
	 */
	getShortcutArray(actionId: string): string[] | undefined {
		// Read version to create reactive dependency
		this.bindings.getVersion();
		const binding = this.getPrimaryKeybinding(actionId);
		return binding ? formatKeyStringToArray(binding.key) : undefined;
	}

	/**
	 * Detect keybinding conflicts.
	 */
	detectConflicts(): KeybindingConflict[] {
		return this.bindings.detectConflicts();
	}

	/**
	 * Search actions by query.
	 */
	searchActions(query: string): Action[] {
		return this.actions.search(query);
	}

	/**
	 * Get actions that are available in the current context.
	 */
	getAvailableActions(): Action[] {
		return this.actions.getAll().filter((action) => this.isActionAvailable(action.id));
	}

	/**
	 * Dispose of the service.
	 */
	dispose(): void {
		this.uninstall();
		this.actions.clear();
		this.bindings.clear();
		this.context.clear();
	}
}

/**
 * Create a new keybindings service instance.
 */
export function createKeybindingsService(): KeybindingsService {
	return new KeybindingsService();
}

/**
 * Singleton instance for global access.
 */
let globalService: KeybindingsService | null = null;

/**
 * Get the global keybindings service instance.
 */
export function getKeybindingsService(): KeybindingsService {
	if (!globalService) {
		globalService = createKeybindingsService();
	}
	return globalService;
}

/**
 * Reset the global keybindings service (for testing).
 */
export function resetKeybindingsService(): void {
	if (globalService) {
		globalService.dispose();
		globalService = null;
	}
}
