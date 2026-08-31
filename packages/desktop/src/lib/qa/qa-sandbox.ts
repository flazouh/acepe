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
	return isQaDrivenWindow(window) || isQaSandboxedSearch(window.location.search);
};

// The QA driver opens the app through a preload that flips this flag, so a live-app
// QA run (which loads the URL with no `?qa=`) still answers "is a human doing this?"
// with no, and durable writes such as the workspace hot cache stay sandboxed.
const isQaDrivenWindow = (window: Window): boolean =>
	(window as unknown as { __acepeQaDriver?: boolean }).__acepeQaDriver === true;
