/**
 * Context Manager - Manages application context for conditional keybindings.
 *
 * Contexts are named boolean/string/number values that represent the current
 * state of the application. Keybindings can use "when" clauses to only be
 * active in certain contexts.
 *
 * Example contexts:
 * - "sidebarOpen" (boolean)
 * - "activeView" (string: "editor" | "settings")
 * - "modalOpen" (boolean)
 * - "inputFocused" (boolean)
 */

import { ok, type Result } from "neverthrow";
import { SvelteMap } from "svelte/reactivity";

import type { ContextValue, KeybindingError } from "../types.js";

/**
 * Context Manager with reactive Svelte 5 state.
 */
export class ContextManager {
	private contexts = new SvelteMap<string, ContextValue>();

	/**
	 * Set a context value.
	 */
	set(key: string, value: ContextValue): void {
		this.contexts.set(key, value);
	}

	/**
	 * Set multiple context values at once.
	 */
	setMany(entries: Record<string, ContextValue>): void {
		for (const [key, value] of Object.entries(entries)) {
			this.contexts.set(key, value);
		}
	}

	/**
	 * Get a context value.
	 */
	get(key: string): ContextValue | undefined {
		return this.contexts.get(key);
	}

	/**
	 * Check if a context key exists.
	 */
	has(key: string): boolean {
		return this.contexts.has(key);
	}

	/**
	 * Delete a context key.
	 */
	delete(key: string): boolean {
		return this.contexts.delete(key);
	}

	/**
	 * Get all context keys.
	 */
	keys(): string[] {
		return Array.from(this.contexts.keys());
	}

	/**
	 * Get all context entries.
	 */
	entries(): Array<[string, ContextValue]> {
		return Array.from(this.contexts.entries());
	}

	/**
	 * Get all contexts as a plain object.
	 */
	toObject(): Record<string, ContextValue> {
		return Object.fromEntries(this.contexts.entries());
	}

	/**
	 * Clear all contexts.
	 */
	clear(): void {
		this.contexts.clear();
	}

	/**
	 * Evaluate a "when" expression against current contexts.
	 *
	 * Supports:
	 * - Simple keys: "sidebarOpen" (checks if truthy)
	 * - Negation: "!modalOpen"
	 * - Equality: "activeView == 'editor'"
	 * - Inequality: "activeView != 'settings'"
	 * - AND: "sidebarOpen && !modalOpen"
	 * - OR: "isEditing || isCreating"
	 * - Parentheses: "(a && b) || c"
	 */
	evaluate(expression: string): Result<boolean, KeybindingError> {
		if (!expression || expression.trim() === "") {
			return ok(true);
		}

		const result = this.evaluateExpression(expression.trim());
		return ok(result);
	}

	/**
	 * Internal expression evaluator.
	 * Uses a simple recursive descent parser for safety (no eval).
	 */
	private evaluateExpression(expr: string): boolean {
		const tokens = this.tokenize(expr);
		const result = this.parseOr(tokens);
		return result.value;
	}

	/**
	 * Tokenize the expression into tokens.
	 */
	private tokenize(expr: string): string[] {
		const tokens: string[] = [];
		let current = "";
		let inString = false;
		let stringChar = "";

		for (let i = 0; i < expr.length; i++) {
			const char = expr[i];

			// Handle string literals
			if ((char === "'" || char === '"') && !inString) {
				inString = true;
				stringChar = char;
				current += char;
				continue;
			}

			if (char === stringChar && inString) {
				inString = false;
				current += char;
				continue;
			}

			if (inString) {
				current += char;
				continue;
			}

			if (char === " " || char === "\t") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				continue;
			}

			if (char === "(" || char === ")") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push(char);
				continue;
			}

			if (char === "&" && expr[i + 1] === "&") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("&&");
				i++;
				continue;
			}

			if (char === "|" && expr[i + 1] === "|") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("||");
				i++;
				continue;
			}

			if (char === "!" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("!=");
				i++;
				continue;
			}

			if (char === "=" && expr[i + 1] === "=") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("==");
				i++;
				continue;
			}

			if (char === "!") {
				if (current) {
					tokens.push(current);
					current = "";
				}
				tokens.push("!");
				continue;
			}

			current += char;
		}

		if (current) {
			tokens.push(current);
		}

		return tokens;
	}

	/**
	 * Parse OR expressions (lowest precedence).
	 */
	private parseOr(tokens: string[]): { value: boolean; rest: string[] } {
		let result = this.parseAnd(tokens);

		while (result.rest.length > 0 && result.rest[0] === "||") {
			const right = this.parseAnd(result.rest.slice(1));
			result = {
				value: result.value || right.value,
				rest: right.rest,
			};
		}

		return result;
	}

	/**
	 * Parse AND expressions.
	 */
	private parseAnd(tokens: string[]): { value: boolean; rest: string[] } {
		let result = this.parseNot(tokens);

		while (result.rest.length > 0 && result.rest[0] === "&&") {
			const right = this.parseNot(result.rest.slice(1));
			result = {
				value: result.value && right.value,
				rest: right.rest,
			};
		}

		return result;
	}

	/**
	 * Parse NOT expressions.
	 */
	private parseNot(tokens: string[]): { value: boolean; rest: string[] } {
		if (tokens[0] === "!") {
			const result = this.parseNot(tokens.slice(1));
			return {
				value: !result.value,
				rest: result.rest,
			};
		}

		return this.parsePrimary(tokens);
	}

	/**
	 * Parse primary expressions (parentheses, comparisons, identifiers).
	 */
	private parsePrimary(tokens: string[]): { value: boolean; rest: string[] } {
		if (tokens.length === 0) {
			return { value: false, rest: [] };
		}

		// Handle parentheses
		if (tokens[0] === "(") {
			const result = this.parseOr(tokens.slice(1));
			// Skip closing paren
			if (result.rest[0] === ")") {
				return {
					value: result.value,
					rest: result.rest.slice(1),
				};
			}
			return result;
		}

		// Handle comparison (key == value or key != value)
		if (tokens.length >= 3 && (tokens[1] === "==" || tokens[1] === "!=")) {
			const key = tokens[0];
			const op = tokens[1];
			const compareValue = this.parseValue(tokens[2]);
			const contextValue = this.get(key);

			const isEqual = contextValue === compareValue;
			return {
				value: op === "==" ? isEqual : !isEqual,
				rest: tokens.slice(3),
			};
		}

		// Handle simple identifier (truthy check)
		const key = tokens[0];
		const value = this.get(key);
		return {
			value: Boolean(value),
			rest: tokens.slice(1),
		};
	}

	/**
	 * Parse a literal value from a token.
	 */
	private parseValue(token: string): ContextValue {
		// String literal (single or double quotes)
		if (
			(token.startsWith("'") && token.endsWith("'")) ||
			(token.startsWith('"') && token.endsWith('"'))
		) {
			return token.slice(1, -1);
		}

		// Boolean literals
		if (token === "true") return true;
		if (token === "false") return false;

		// Number literal
		const num = Number(token);
		if (!Number.isNaN(num)) return num;

		// Otherwise treat as string
		return token;
	}
}

/**
 * Create a new context manager instance.
 */
export function createContextManager(): ContextManager {
	return new ContextManager();
}
