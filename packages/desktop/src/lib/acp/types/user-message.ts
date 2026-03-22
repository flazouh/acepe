import type { ContentBlock } from "../../services/converted-session-types.js";

/**
 * User message in a thread.
 *
 * Represents a message sent by the user to the agent.
 */
export type UserMessage = {
	/**
	 * Optional unique identifier for this message.
	 */
	id?: string;

	/**
	 * Content of the message.
	 */
	content: ContentBlock;

	/**
	 * Raw content blocks from the ACP protocol.
	 */
	chunks: ContentBlock[];

	/**
	 * Timestamp when the message was sent.
	 *
	 * Used to display message timing and measure send latency.
	 */
	sentAt?: Date;

	/**
	 * Optional checkpoint information.
	 */
	checkpoint?: {
		show: boolean;
	};
};
