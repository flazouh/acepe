// Re-export QuestionItem from generated types for use in stores
export type { QuestionItem, QuestionOption } from "../../services/converted-session-types.js";

import type { InteractionReplyHandler as GeneratedInteractionReplyHandler } from "../../services/converted-session-types.js";
import type { InteractionReplyHandler, InteractionReplyHandlerInput } from "./reply-handler.js";

/**
 * Question request from the agent.
 *
 * Represents an interactive question that requires user input.
 */
export interface QuestionRequest {
	/**
	 * Unique identifier for this question.
	 */
	id: string;

	/**
	 * The session this question belongs to.
	 */
	sessionId: string;

	/**
	 * The JSON-RPC request ID for this question request.
	 * Used to send the response back to the ACP subprocess.
	 * Only present for ACP mode (Claude Code's AskUserQuestion tool).
	 */
	jsonRpcRequestId?: number;

	/**
	 * Explicit reply routing metadata for this interaction.
	 */
	replyHandler?: InteractionReplyHandler;

	/**
	 * The questions to present to the user.
	 */
	questions: Array<{
		/**
		 * The question text to display.
		 */
		question: string;

		/**
		 * Header text for the question section.
		 */
		header: string;

		/**
		 * Available options for the answer.
		 */
		options: Array<{
			/**
			 * Label to display for this option.
			 */
			label: string;

			/**
			 * Description of this option.
			 */
			description: string;
		}>;

		/**
		 * Whether multiple selections are allowed.
		 */
		multiSelect: boolean;
	}>;

	/**
	 * Optional reference to the tool call that triggered this question.
	 */
	tool?: {
		messageID: string;
		callID: string;
	};
}

export interface AnsweredQuestion {
	questions: QuestionRequest["questions"];
	answers: Record<string, string | string[]>;
	answeredAt: number;
	cancelled?: boolean;
}

/**
 * Answered question data for display in the UI.
 */
export interface AnsweredQuestion {
	questions: QuestionRequest["questions"];
	answers: Record<string, string | string[]>;
	answeredAt: number;
	cancelled?: boolean;
}

/**
 * Answer to a question.
 */
export interface QuestionAnswer {
	/**
	 * The question index.
	 */
	questionIndex: number;

	/**
	 * The selected option label(s).
	 */
	answers: string[];
}

/**
 * Response to a question request.
 */
export interface QuestionResponse {
	/**
	 * The question request ID.
	 */
	id: string;

	/**
	 * The answers to the questions.
	 */
	answers: QuestionAnswer[];
}

export type QuestionReplyHandlerInput =
	| InteractionReplyHandler
	| InteractionReplyHandlerInput
	| GeneratedInteractionReplyHandler
	| null
	| undefined;

/**
 * Question update event from the ACP protocol.
 */
export type QuestionUpdate = {
	type: "questionRequest";
	question: QuestionRequest;
};
