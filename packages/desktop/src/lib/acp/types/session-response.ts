import type { NewSessionResponse } from "./new-session-response.js";
import type { ResumeSessionResponse } from "./resume-session-response.js";

/**
 * Discriminated union of new and resume session responses.
 *
 * Used internally for unified handling of session creation results.
 * The `type` field distinguishes between new and resumed sessions.
 */
export type SessionResponse =
	| ({ type: "new" } & NewSessionResponse)
	| ({ type: "resume" } & ResumeSessionResponse);
