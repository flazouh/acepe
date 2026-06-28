import {
	deriveSessionTitleFromUserInput,
	isFallbackSessionTitle,
} from "../../../store/session-title-policy.js";

/**
 * Optimistic header identity — surfaces the agent + title the user already
 * implied at the instant of send, across the entire window before canonical
 * session state materializes.
 *
 * Deferred-creation providers (e.g. Claude Code) take seconds to produce a
 * session id and then canonical state. Across that window the header title +
 * working spark used to derive only from canonical identity, so a freshly-sent
 * thread showed a generic "Conversation in <project>" header and a plain
 * "Planning next moves" placeholder, and even *reverted* to the generic header
 * once a session id appeared but canonical was still missing. These resolvers
 * fill the whole pre-canonical window so send-moment == final state, then defer
 * to canonical the instant it owns a real title / agent id.
 */

/**
 * Optimistic header title for the pre-canonical window. Derived from the pending
 * first user message. A real canonical title wins; an absent or still-fallback
 * canonical title (e.g. "New Thread", "Session abc123") does not, so the header
 * never reverts to a placeholder between send and canonical promotion. Returns
 * null when there is no message yet or canonical already owns a real title.
 */
export function resolveOptimisticHeaderTitle(input: {
	readonly canonicalTitle: string | null;
	readonly pendingUserMessageText: string | null;
}): string | null {
	if (input.canonicalTitle !== null && !isFallbackSessionTitle(input.canonicalTitle)) {
		return null;
	}
	if (input.pendingUserMessageText === null) {
		return null;
	}
	return deriveSessionTitleFromUserInput(input.pendingUserMessageText);
}

/**
 * Whether the Claude working spark should render. Canonical agent identity wins;
 * before a session exists the composer's selected agent stands in so the spark
 * is optimistic from t=0. Claude Code is the only agent with a bespoke working
 * spark.
 */
export function shouldShowClaudeWorkingSpark(input: {
	readonly sessionAgentId: string | null;
	readonly selectedAgentId: string | null;
}): boolean {
	return (input.sessionAgentId ?? input.selectedAgentId) === "claude-code";
}
