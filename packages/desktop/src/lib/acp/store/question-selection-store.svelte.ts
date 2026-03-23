/**
 * Question Selection Store - Manages selection state for interactive questions.
 *
 * This store synchronizes selection state between the queue item UI and the agent panel UI,
 * allowing users to interact with questions from either location with consistent state.
 */

import { getContext, setContext } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";

const QUESTION_SELECTION_STORE_KEY = Symbol("question-selection-store");

/**
 * Selection state for a single question.
 * Uses Svelte reactive collections so this remains compatible in both
 * Svelte runtime and Bun test environments.
 */
export class QuestionSelectionState {
	private static readonly OTHER_MODE_ACTIVE_KEY = "otherModeActive";
	private static readonly OTHER_TEXT_VALUE_KEY = "otherTextValue";

	/** Selected option labels (for both single and multi-select) */
	selectedOptions = new SvelteSet<string>();
	/** Reactive scalar values for "other mode" state. */
	private flags = new SvelteMap<string, string | boolean>();

	constructor() {
		this.flags.set(QuestionSelectionState.OTHER_MODE_ACTIVE_KEY, false);
		this.flags.set(QuestionSelectionState.OTHER_TEXT_VALUE_KEY, "");
	}

	get otherModeActive(): boolean {
		const value = this.flags.get(QuestionSelectionState.OTHER_MODE_ACTIVE_KEY);
		return value === true;
	}

	set otherModeActive(active: boolean) {
		this.flags.set(QuestionSelectionState.OTHER_MODE_ACTIVE_KEY, active);
	}

	get otherTextValue(): string {
		const value = this.flags.get(QuestionSelectionState.OTHER_TEXT_VALUE_KEY);
		return typeof value === "string" ? value : "";
	}

	set otherTextValue(value: string) {
		this.flags.set(QuestionSelectionState.OTHER_TEXT_VALUE_KEY, value);
	}
}

/**
 * Store for managing question selection state across UI components.
 *
 * State is keyed by question ID (from pendingQuestion.id or toolCall.id),
 * allowing multiple questions to have independent selection states.
 */
export class QuestionSelectionStore {
	/** Map of questionId -> questionIndex -> selection state */
	private selections = new SvelteMap<string, SvelteMap<number, QuestionSelectionState>>();

	/**
	 * Get existing state for a question (read-only, returns undefined if not found).
	 * Use this in $derived contexts to avoid state mutations.
	 */
	private getState(questionId: string, questionIndex: number): QuestionSelectionState | undefined {
		return this.selections.get(questionId)?.get(questionIndex);
	}

	/**
	 * Get or create selection state for a question.
	 * Only use this in mutation contexts (event handlers), never in $derived.
	 */
	private getOrCreateState(questionId: string, questionIndex: number): QuestionSelectionState {
		let questionSelections = this.selections.get(questionId);
		if (!questionSelections) {
			questionSelections = new SvelteMap<number, QuestionSelectionState>();
			this.selections.set(questionId, questionSelections);
		}

		let state = questionSelections.get(questionIndex);
		if (!state) {
			state = new QuestionSelectionState();
			questionSelections.set(questionIndex, state);
		}

		return state;
	}

	/**
	 * Get selected options for a question.
	 * Returns empty set if state doesn't exist (read-only).
	 */
	getSelectedOptions(questionId: string, questionIndex: number): ReadonlySet<string> {
		return this.getState(questionId, questionIndex)?.selectedOptions ?? new SvelteSet();
	}

	/**
	 * Check if an option is selected (read-only, safe for $derived).
	 */
	isOptionSelected(questionId: string, questionIndex: number, label: string): boolean {
		return this.getState(questionId, questionIndex)?.selectedOptions.has(label) ?? false;
	}

	/**
	 * Toggle an option selection (for multi-select).
	 */
	toggleOption(questionId: string, questionIndex: number, label: string): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		if (state.selectedOptions.has(label)) {
			state.selectedOptions.delete(label);
		} else {
			state.selectedOptions.add(label);
		}
	}

	/**
	 * Set a single option (for single-select, clears others).
	 */
	setSingleOption(questionId: string, questionIndex: number, label: string): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		state.selectedOptions.clear();
		state.selectedOptions.add(label);
		// Deactivate "Other" mode when selecting a predefined option
		state.otherModeActive = false;
	}

	/**
	 * Clear all selections for a question index.
	 */
	clearSelections(questionId: string, questionIndex: number): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		state.selectedOptions.clear();
	}

	/**
	 * Check if "Other" mode is active (read-only, safe for $derived).
	 */
	isOtherActive(questionId: string, questionIndex: number): boolean {
		return this.getState(questionId, questionIndex)?.otherModeActive ?? false;
	}

	/**
	 * Toggle "Other" mode.
	 */
	toggleOtherMode(
		questionId: string,
		questionIndex: number,
		clearSelectionsIfActivating: boolean = false
	): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		state.otherModeActive = !state.otherModeActive;

		// When activating "Other" in single-select mode, clear predefined selections
		if (state.otherModeActive && clearSelectionsIfActivating) {
			state.selectedOptions.clear();
		}

		// Clear text when deactivating
		if (!state.otherModeActive) {
			state.otherTextValue = "";
		}
	}

	/**
	 * Set "Other" mode active state directly.
	 */
	setOtherModeActive(questionId: string, questionIndex: number, active: boolean): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		state.otherModeActive = active;
		if (!active) {
			state.otherTextValue = "";
		}
	}

	/**
	 * Get "Other" text value (read-only, safe for $derived).
	 */
	getOtherText(questionId: string, questionIndex: number): string {
		return this.getState(questionId, questionIndex)?.otherTextValue ?? "";
	}

	/**
	 * Set "Other" text value.
	 */
	setOtherText(questionId: string, questionIndex: number, value: string): void {
		const state = this.getOrCreateState(questionId, questionIndex);
		state.otherTextValue = value;
	}

	/**
	 * Check if a question has any selections (options or "Other" text).
	 * Read-only, safe for $derived.
	 */
	hasSelections(questionId: string, questionIndex: number): boolean {
		const state = this.getState(questionId, questionIndex);
		if (!state) return false;
		if (state.selectedOptions.size > 0) return true;
		if (state.otherModeActive && state.otherTextValue.trim()) return true;
		return false;
	}

	/**
	 * Get all answers for a question (combining selected options and "Other" text).
	 * Read-only, safe for $derived.
	 */
	getAnswers(questionId: string, questionIndex: number, isMultiSelect: boolean): string[] {
		const state = this.getState(questionId, questionIndex);
		if (!state) return [];

		if (isMultiSelect) {
			// Multi-select: return all selected options plus "Other" text if provided
			const answers = Array.from(state.selectedOptions);
			if (state.otherModeActive && state.otherTextValue.trim()) {
				answers.push(state.otherTextValue.trim());
			}
			return answers;
		} else {
			// Single-select: return "Other" text if active, otherwise the single selected option
			if (state.otherModeActive && state.otherTextValue.trim()) {
				return [state.otherTextValue.trim()];
			}
			return Array.from(state.selectedOptions);
		}
	}

	/**
	 * Clear all state for a question (when question is answered or cancelled).
	 */
	clearQuestion(questionId: string): void {
		this.selections.delete(questionId);
	}

	/**
	 * Check if any question index has selections for a given question ID.
	 */
	hasAnySelections(questionId: string): boolean {
		const questionSelections = this.selections.get(questionId);
		if (!questionSelections) return false;

		for (const state of questionSelections.values()) {
			if (state.selectedOptions.size > 0) return true;
			if (state.otherModeActive && state.otherTextValue.trim()) return true;
		}
		return false;
	}
}

/**
 * Create and set the question selection store in Svelte context.
 */
export function createQuestionSelectionStore(): QuestionSelectionStore {
	const store = new QuestionSelectionStore();
	setContext(QUESTION_SELECTION_STORE_KEY, store);
	return store;
}

/**
 * Get the question selection store from Svelte context.
 */
export function getQuestionSelectionStore(): QuestionSelectionStore {
	return getContext<QuestionSelectionStore>(QUESTION_SELECTION_STORE_KEY);
}
