/**
 * Answer option for an ask message.
 *
 * Represents a single selectable option in response to a question.
 */
export type AnswerOption = {
	/**
	 * Unique identifier for this option.
	 */
	id: string;

	/**
	 * Display text for this option.
	 */
	label: string;

	/**
	 * Optional description for this option.
	 */
	description?: string;
};

/**
 * Ask message in a thread.
 *
 * Represents a question posed by the agent that requires user selection.
 */
export type AskMessage = {
	/**
	 * Unique identifier for this ask message.
	 */
	id: string;

	/**
	 * The question text to display.
	 */
	question: string;

	/**
	 * Optional detailed description of the question.
	 */
	description?: string;

	/**
	 * Available answer options.
	 */
	options: AnswerOption[];

	/**
	 * Unique identifier for the corresponding ask request.
	 * Used to match the response back to the ask call.
	 */
	requestId?: string;
};
