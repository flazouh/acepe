/**
 * Statistics for a single thread/conversation.
 *
 * Contains aggregated data about messages, tokens, and tool calls
 * in a conversation.
 */
export type ThreadStatistics = {
	/**
	 * The conversation ID.
	 */
	conversationId: string;

	/**
	 * Total number of messages (user + assistant).
	 */
	messageCount: number;

	/**
	 * Number of user messages.
	 */
	userMessageCount: number;

	/**
	 * Number of assistant messages.
	 */
	assistantMessageCount: number;

	/**
	 * Number of tool use calls.
	 */
	toolUseCount: number;

	/**
	 * Total input tokens used.
	 */
	inputTokens: number;

	/**
	 * Total output tokens generated.
	 */
	outputTokens: number;
};
