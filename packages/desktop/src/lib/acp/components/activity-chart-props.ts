import type { SessionListItem } from "./session-list/session-list-types";

/**
 * Props for the ActivityChart component.
 */
export interface ActivityChartProps {
	/**
	 * Sessions to analyze for activity data.
	 * Only sessions with updatedAt timestamps are used.
	 */
	sessions: ReadonlyArray<Pick<SessionListItem, "updatedAt">>;
}
