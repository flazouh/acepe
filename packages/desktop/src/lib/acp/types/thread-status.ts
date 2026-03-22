/**
 * Status of an ACP thread.
 *
 * Represents the current state of a thread.
 *
 * Flow: idle → sending → planning → streaming → idle
 * - sending: Message sent, connecting to agent
 * - planning: Agent is thinking/planning next moves
 * - streaming: Agent is actively responding
 */
export type ThreadStatus =
	| "idle"
	| "loading"
	| "sending"
	| "planning"
	| "waiting"
	| "streaming"
	| "error"
	| "completed";
