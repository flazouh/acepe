/**
 * Action Registry - Central registry for all application actions.
 *
 * Actions are the "what" - they define executable commands that can be
 * triggered by keybindings, command palette, or programmatically.
 */

import { err, ok, okAsync, Result, ResultAsync } from "neverthrow";

import type { ContextManager } from "../context/manager.svelte.js";
import type { Action, ActionCategory } from "../types.js";

import { KeybindingError } from "../types.js";

export class ActionRegistry {
	private actions = new Map<string, Action>();

	/**
	 * Register a new action.
	 */
	register(action: Action): Result<void, KeybindingError> {
		if (this.actions.has(action.id)) {
			return err(
				new KeybindingError("ACTION_ALREADY_EXISTS", `Action "${action.id}" already registered`)
			);
		}
		this.actions.set(action.id, action);
		return ok(undefined);
	}

	/**
	 * Register or update an action (upsert).
	 */
	upsert(action: Action): void {
		this.actions.set(action.id, action);
	}

	/**
	 * Register multiple actions at once.
	 */
	registerMany(actions: Action[]): Result<void, KeybindingError> {
		for (const action of actions) {
			const result = this.register(action);
			if (result.isErr()) {
				return result;
			}
		}
		return ok(undefined);
	}

	/**
	 * Upsert multiple actions at once.
	 */
	upsertMany(actions: Action[]): void {
		for (const action of actions) {
			this.upsert(action);
		}
	}

	/**
	 * Unregister an action by ID.
	 */
	unregister(id: string): Result<void, KeybindingError> {
		if (!this.actions.has(id)) {
			return err(new KeybindingError("ACTION_NOT_FOUND", `Action "${id}" not found`));
		}
		this.actions.delete(id);
		return ok(undefined);
	}

	/**
	 * Get an action by ID.
	 */
	get(id: string): Result<Action, KeybindingError> {
		const action = this.actions.get(id);
		if (!action) {
			return err(new KeybindingError("ACTION_NOT_FOUND", `Action "${id}" not found`));
		}
		return ok(action);
	}

	/**
	 * Check if an action exists.
	 */
	has(id: string): boolean {
		return this.actions.has(id);
	}

	/**
	 * Get all registered actions.
	 */
	getAll(): Action[] {
		return Array.from(this.actions.values());
	}

	/**
	 * Get actions filtered by category.
	 */
	getByCategory(category: ActionCategory): Action[] {
		return this.getAll().filter((action) => action.category === category);
	}

	/**
	 * Search actions by label or description.
	 */
	search(query: string): Action[] {
		const lowerQuery = query.toLowerCase();
		return this.getAll().filter(
			(action) =>
				action.label.toLowerCase().includes(lowerQuery) ||
				action.description?.toLowerCase().includes(lowerQuery) ||
				action.id.toLowerCase().includes(lowerQuery)
		);
	}

	/**
	 * Execute an action by ID.
	 */
	execute(id: string, contextManager?: ContextManager): ResultAsync<void, KeybindingError> {
		const actionResult = this.get(id);
		if (actionResult.isErr()) {
			return okAsync().andThen(() => err(actionResult.error));
		}

		const action = actionResult.value;

		// Check context if provided
		if (action.when && contextManager) {
			const contextResult = contextManager.evaluate(action.when);
			if (contextResult.isErr()) {
				return okAsync().andThen(() => err(contextResult.error));
			}
			if (!contextResult.value) {
				return okAsync().andThen(() =>
					err(
						new KeybindingError(
							"CONTEXT_CHECK_FAILED",
							`Action "${id}" context check failed: ${action.when}`
						)
					)
				);
			}
		}

		return ResultAsync.fromPromise(
			Promise.resolve(action.handler()),
			(error) => new KeybindingError("EXECUTION_FAILED", `Action "${id}" execution failed`, error)
		);
	}

	/**
	 * Execute an action synchronously by ID.
	 * Use this for keybinding handlers where immediate execution is preferred.
	 * Returns Result instead of ResultAsync for synchronous error handling.
	 */
	executeSync(id: string, contextManager?: ContextManager): Result<void, KeybindingError> {
		const actionResult = this.get(id);
		if (actionResult.isErr()) {
			return err(actionResult.error);
		}

		const action = actionResult.value;

		// Check context if provided
		if (action.when && contextManager) {
			const contextResult = contextManager.evaluate(action.when);
			if (contextResult.isErr()) {
				return err(contextResult.error);
			}
			if (!contextResult.value) {
				return err(
					new KeybindingError(
						"CONTEXT_CHECK_FAILED",
						`Action "${id}" context check failed: ${action.when}`
					)
				);
			}
		}

		const safeHandler = Result.fromThrowable(
			() => {
				action.handler();
			},
			(error) => new KeybindingError("EXECUTION_FAILED", `Action "${id}" execution failed`, error)
		);
		return safeHandler();
	}

	/**
	 * Check if an action is available in the current context.
	 */
	isAvailable(id: string, contextManager?: ContextManager): boolean {
		const actionResult = this.get(id);
		if (actionResult.isErr()) {
			return false;
		}

		const action = actionResult.value;
		if (!(action.when && contextManager)) {
			return true;
		}

		const contextResult = contextManager.evaluate(action.when);
		return contextResult.isOk() && contextResult.value;
	}

	/**
	 * Get the count of registered actions.
	 */
	get size(): number {
		return this.actions.size;
	}

	/**
	 * Clear all registered actions.
	 */
	clear(): void {
		this.actions.clear();
	}
}

/**
 * Create a new action registry instance.
 */
export function createActionRegistry(): ActionRegistry {
	return new ActionRegistry();
}
