import { err, ok, type Result } from "neverthrow";
import { getCaretCoordinates } from "../../../utils/textarea-caret.js";
import { ValidationError } from "../errors/agent-input-error.js";
import type { DropdownPosition } from "../types/dropdown-position.js";

/**
 * Calculates the dropdown position based on caret coordinates in a textarea.
 *
 * @param textarea - The textarea element
 * @param triggerIndex - Character index where the trigger was detected
 * @returns Result containing the dropdown position
 *
 * @example
 * ```ts
 * const result = calculateDropdownPosition(textarea, 10);
 * if (result.isOk()) {
 *   // Position dropdown at result.value.top, result.value.left
 * }
 * ```
 */
export function calculateDropdownPosition(
	textarea: HTMLTextAreaElement,
	triggerIndex: number
): Result<DropdownPosition, ValidationError> {
	if (!textarea) {
		return err(new ValidationError("Textarea element is required", "textarea"));
	}

	if (triggerIndex < 0 || triggerIndex > textarea.value.length) {
		return err(
			new ValidationError(
				`Invalid trigger index: ${triggerIndex} (textarea length: ${textarea.value.length})`,
				"triggerIndex"
			)
		);
	}

	const caretCoords = getCaretCoordinates(textarea, triggerIndex);
	const rect = textarea.getBoundingClientRect();

	// Return viewport-relative coordinates for position: fixed
	return ok({
		top: rect.top + caretCoords.top - textarea.scrollTop,
		left: rect.left + caretCoords.left - textarea.scrollLeft,
	});
}
