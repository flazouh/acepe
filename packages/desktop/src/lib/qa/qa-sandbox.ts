/**
 * Keeping a QA replay out of the user's real workspace.
 *
 * A scenario runs against a fake server, so its RPC writes go nowhere. Browser
 * storage is not part of that: `localStorage` is shared with the normal app, so
 * anything a replay caches there survives the switch back and the next launch.
 * The workspace hot cache is the live example -- a replay opens a panel per
 * session in the recording, and that layout would be what the user comes back
 * to.
 *
 * The answer is read from the URL rather than held in a flag. `?qa=` already
 * decides whether this page is replaying, it cannot change while the page
 * lives, and a derived answer has no setter for a caller to forget and no
 * global for one test to leak into the next.
 */

import { readQaMode } from "./qa-mode.ts";

/** Pure half, so the rule is testable without a window. */
export const isQaSandboxedSearch = (search: string): boolean => readQaMode(search) !== null;

/** True while this page is replaying a scenario. Persist nothing durable. */
export const isQaSandboxed = (): boolean => {
	if (typeof window === "undefined") {
		return false;
	}
	return isQaSandboxedSearch(window.location.search);
};
