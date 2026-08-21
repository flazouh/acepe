/**
 * Action Registry - Central registry for all application actions.
 *
 * Actions are the "what" - they define executable commands that can be
 * triggered by keybindings, command palette, or programmatically.
 */

import { fromPromise } from "@acepe/effect-result/fromPromise";
import { fromThrowable } from "@acepe/effect-result/fromThrowable";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { ContextManager } from "../context/manager.svelte.js";
import type { Action, ActionCategory } from "../types.js";

import { KeybindingError } from "../types.js";

export class ActionRegistry {
	private actions = new Map<string, Action>();

	/**
	 * Register a new action.
	 */
	register(action: Action): Result.Result<void, KeybindingError> {
		if (this.actions.has(action.id)) {
			return Result.fail(
				new KeybindingError("ACTION_ALREADY_EXISTS", `Action "${action.id}" already registered`)
			);
		}
		this.actions.set(action.id, action);
		return Result.succeed(undefined);
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
	registerMany(actions: Action[]): Result.Result<void, KeybindingError> {
		for (const action of actions) {
			const result = this.register(action);
			if (Result.isFailure(result)) {
				return result;
			}
		}
		return Result.succeed(undefined);
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
	unregister(id: string): Result.Result<void, KeybindingError> {
		if (!this.actions.has(id)) {
			return Result.fail(new KeybindingError("ACTION_NOT_FOUND", `Action "${id}" not found`));
		}
		this.actions.delete(id);
		return Result.succeed(undefined);
	}

	/**
	 * Get an action by ID.
	 */
	get(id: string): Result.Result<Action, KeybindingError> {
		const action = this.actions.get(id);
		if (!action) {
			return Result.fail(new KeybindingError("ACTION_NOT_FOUND", `Action "${id}" not found`));
		}
		return Result.succeed(action);
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
	execute(id: string, contextManager?: ContextManager): Effect.Effect<void, KeybindingError> {
		const actionResult = this.get(id);
		if (Result.isFailure(actionResult)) {
			return Effect.fail(actionResult.failure);
		}

		const action = actionResult.success;

		// Check context if provided
		if (action.when && contextManager) {
			const contextResult = contextManager.evaluate(action.when);
			if (Result.isFailure(contextResult)) {
				return Effect.fail(contextResult.failure);
			}
			if (!contextResult.success) {
				return Effect.fail(
					new KeybindingError(
						"CONTEXT_CHECK_FAILED",
						`Action "${id}" context check failed: ${action.when}`
					)
				);
			}
		}

		return fromPromise(
			() => Promise.resolve(action.handler()),
			(error) => new KeybindingError("EXECUTION_FAILED", `Action "${id}" execution failed`, error)
		);
	}

	/**
	 * Execute an action synchronously by ID.
	 * Use this for keybinding handlers where immediate execution is preferred.
	 * Returns Result instead of Effect for synchronous error handling.
	 */
	executeSync(id: string, contextManager?: ContextManager): Result.Result<void, KeybindingError> {
		const actionResult = this.get(id);
		if (Result.isFailure(actionResult)) {
			return Result.fail(actionResult.failure);
		}

		const action = actionResult.success;

		// Check context if provided
		if (action.when && contextManager) {
			const contextResult = contextManager.evaluate(action.when);
			if (Result.isFailure(contextResult)) {
				return Result.fail(contextResult.failure);
			}
			if (!contextResult.success) {
				return Result.fail(
					new KeybindingError(
						"CONTEXT_CHECK_FAILED",
						`Action "${id}" context check failed: ${action.when}`
					)
				);
			}
		}

		const safeHandler = fromThrowable(
			() => {
				action.handler();
			},
			(error) => new KeybindingError("EXECUTION_FAILED", `Action "${id}" execution failed`, error)
		);
		return Effect.runSync(Effect.result(safeHandler()));
	}

	/**
	 * Check if an action is available in the current context.
	 */
	isAvailable(id: string, contextManager?: ContextManager): boolean {
		const actionResult = this.get(id);
		if (Result.isFailure(actionResult)) {
			return false;
		}

		const action = actionResult.success;
		if (!(action.when && contextManager)) {
			return true;
		}

		const contextResult = contextManager.evaluate(action.when);
		return Result.isSuccess(contextResult) && contextResult.success;
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
