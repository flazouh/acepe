/**
 * Response from a prompt request.
 *
 * This is a flexible type that may contain various response data
 * depending on the agent's implementation.
 *
 * @see https://agentclientprotocol.com/protocol/#prompt
 */
export type PromptResponse = Record<string, unknown>;
