/**
 * Keybinding Registry - Maps keyboard shortcuts to actions.
 *
 * Keybindings are the "how" - they define which key combinations trigger
 * which actions. Uses tinykeys for efficient keyboard event handling.
 */

import * as Result from "effect/Result";
import { SvelteMap } from "svelte/reactivity";
import { tinykeys } from "tinykeys";
import type { ActionRegistry } from "../actions/registry.js";
import type { ContextManager } from "../context/manager.svelte.js";
import type { Keybinding, KeybindingConflict } from "../types.js";

import { KeybindingError } from "../types.js";

function isSequenceKeybinding(key: string): boolean {
	return key.includes(" ") && !key.includes("+");
}

export class KeybindingRegistry {
	private bindings = $state<Keybinding[]>([]);
	// Version counter to trigger reactivity when bindings change
	private version = $state(0);
	private unsubscribe: (() => void) | null = null;
	private actionRegistry: ActionRegistry | null = null;
	private contextManager: ContextManager | null = null;

	/**
	 * Get the current version number. Reading this creates a reactive dependency.
	 */
	getVersion(): number {
		return this.version;
	}

	/**
	 * Register a new keybinding.
	 */
	register(binding: Keybinding): Result.Result<void, KeybindingError> {
		if (isSequenceKeybinding(binding.key)) {
			return Result.fail(
				new KeybindingError(
					"INVALID_KEYBINDING",
					`Keybinding sequences are not supported: "${binding.key}"`
				)
			);
		}

		// Check for exact duplicates
		const existing = this.bindings.find(
			(b) => b.key === binding.key && b.command === binding.command
		);
		if (existing) {
			return Result.fail(
				new KeybindingError(
					"BINDING_CONFLICT",
					`Keybinding "${binding.key}" -> "${binding.command}" already exists`
				)
			);
		}

		this.bindings = [...this.bindings, { ...binding, source: binding.source ?? "default" }];
		this.version++;
		return Result.succeed(undefined);
	}

	/**
	 * Register multiple keybindings at once.
	 */
	registerMany(bindings: Keybinding[]): Result.Result<void, KeybindingError> {
		for (const binding of bindings) {
			const result = this.register(binding);
			if (Result.isFailure(result)) {
				return result;
			}
		}
		return Result.succeed(undefined);
	}

	/**
	 * Upsert a keybinding (add or replace).
	 */
	upsert(binding: Keybinding): void {
		if (isSequenceKeybinding(binding.key)) {
			return;
		}

		// Remove existing binding for same key+command and add new one
		const filtered = this.bindings.filter(
			(b) => !(b.key === binding.key && b.command === binding.command)
		);
		this.bindings = [...filtered, { ...binding, source: binding.source ?? "default" }];
		this.version++;
	}

	/**
	 * Upsert multiple keybindings.
	 */
	upsertMany(bindings: Keybinding[]): void {
		for (const binding of bindings) {
			this.upsert(binding);
		}
	}

	/**
	 * Remove a keybinding.
	 */
	unregister(key: string, command: string): Result.Result<void, KeybindingError> {
		const index = this.bindings.findIndex((b) => b.key === key && b.command === command);
		if (index === -1) {
			return Result.fail(
				new KeybindingError("ACTION_NOT_FOUND", `Keybinding "${key}" -> "${command}" not found`)
			);
		}
		// Create new array without the removed binding
		this.bindings = this.bindings.filter((_, i) => i !== index);
		this.version++;
		return Result.succeed(undefined);
	}

	/**
	 * Remove all keybindings for a specific key.
	 */
	unregisterKey(key: string): void {
		this.bindings = this.bindings.filter((b) => b.key !== key);
		this.version++;
	}

	/**
	 * Remove all keybindings for a specific command.
	 */
	unregisterCommand(command: string): void {
		this.bindings = this.bindings.filter((b) => b.command !== command);
		this.version++;
	}

	/**
	 * Get all registered keybindings.
	 * Reading version ensures reactivity when bindings change.
	 */
	getAll(): Keybinding[] {
		// Read version to create reactive dependency
		void this.version;
		return [...this.bindings];
	}

	/**
	 * Get keybindings for a specific command.
	 */
	getForCommand(command: string): Keybinding[] {
		return this.bindings.filter((b) => b.command === command);
	}

	/**
	 * Get the primary keybinding for a command.
	 */
	getPrimaryForCommand(command: string): Keybinding | undefined {
		return this.bindings.find((b) => b.command === command);
	}

	/**
	 * Get keybindings for a specific key.
	 */
	getForKey(key: string): Keybinding[] {
		return this.bindings.filter((b) => b.key === key);
	}

	/**
	 * Detect conflicts between keybindings.
	 * Returns bindings that share the same key without mutually exclusive contexts.
	 */
	detectConflicts(): KeybindingConflict[] {
		const keyGroups = new SvelteMap<string, Keybinding[]>();

		for (const binding of this.bindings) {
			const existing = keyGroups.get(binding.key) ?? [];
			existing.push(binding);
			keyGroups.set(binding.key, existing);
		}

		const conflicts: KeybindingConflict[] = [];

		for (const [key, bindings] of keyGroups) {
			if (bindings.length > 1) {
				// Check if any bindings could potentially conflict
				// (both have no context, or same context)
				const hasConflict = bindings.some((a, i) =>
					bindings.slice(i + 1).some((b) => {
						// No context on both = conflict
						if (!(a.when || b.when)) return true;
						// Same context = conflict
						if (a.when === b.when) return true;
						// Different contexts = probably okay
						return false;
					})
				);

				if (hasConflict) {
					conflicts.push({ key, bindings });
				}
			}
		}

		return conflicts;
	}

	/**
	 * Install keybindings on a target element.
	 */
	install(
		target: Window | HTMLElement,
		actionRegistry: ActionRegistry,
		contextManager: ContextManager
	): Result.Result<void, KeybindingError> {
		// Store references for reinstall
		this.actionRegistry = actionRegistry;
		this.contextManager = contextManager;

		// Uninstall previous bindings
		this.uninstall();

		const keyMap: Record<string, (event: KeyboardEvent) => void> = {};

		for (const binding of this.bindings) {
			// If multiple bindings share the same key, we need to handle context
			const hasExistingHandler = binding.key in keyMap;

			if (hasExistingHandler) {
				// Wrap to check context for multiple bindings on same key
				const bindings = this.getForKey(binding.key);
				keyMap[binding.key] = (event: KeyboardEvent) => {
					for (const b of bindings) {
						// Check context
						if (b.when) {
							const contextResult = contextManager.evaluate(b.when);
							if (!Result.isSuccess(contextResult) || !contextResult.success) {
								continue;
							}
						}

						// Execute action synchronously for immediate response
						event.preventDefault();
						actionRegistry.executeSync(b.command, contextManager);
						return;
					}
				};
			} else {
				keyMap[binding.key] = (event: KeyboardEvent) => {
					// Check context
					if (binding.when) {
						const contextResult = contextManager.evaluate(binding.when);
						if (!Result.isSuccess(contextResult) || !contextResult.success) {
							return;
						}
					}

					// Execute action synchronously for immediate response
					event.preventDefault();
					actionRegistry.executeSync(binding.command, contextManager);
				};
			}
		}

		this.unsubscribe = tinykeys(target as Window, keyMap);
		return Result.succeed(undefined);
	}

	/**
	 * Reinstall keybindings (after adding/removing bindings).
	 */
	reinstall(target: Window | HTMLElement): Result.Result<void, KeybindingError> {
		if (!(this.actionRegistry && this.contextManager)) {
			return Result.fail(
				new KeybindingError("INSTALL_FAILED", "Cannot reinstall - no previous install found")
			);
		}
		return this.install(target, this.actionRegistry, this.contextManager);
	}

	/**
	 * Uninstall keybindings.
	 */
	uninstall(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	/**
	 * Check if keybindings are currently installed.
	 */
	isInstalled(): boolean {
		return this.unsubscribe !== null;
	}

	/**
	 * Get the count of registered keybindings.
	 */
	get size(): number {
		return this.bindings.length;
	}

	/**
	 * Clear all registered keybindings.
	 */
	clear(): void {
		this.bindings = [];
		this.version++;
		this.uninstall();
	}
}

/**
 * Create a new keybinding registry instance.
 */
export function createKeybindingRegistry(): KeybindingRegistry {
	return new KeybindingRegistry();
}
