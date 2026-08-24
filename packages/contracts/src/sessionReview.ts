import * as Schema from "effect/Schema"

import { Sequence, TrimmedNonEmptyString } from "./baseSchemas.ts"
import { SessionId } from "./ids.ts"

// One row per (sessionId, revisionKey): a whole-file reviewed/unreviewed
// boolean, where revisionKey encodes the file path plus a content hash so a
// file re-marks itself unreviewed when its content changes. See
// packages/desktop/src/lib/acp/store/session-review-state-store.svelte.ts,
// the client-side store this projection backs.
export const SessionReviewFile = Schema.Struct({
	revisionKey: TrimmedNonEmptyString,
	filePath: TrimmedNonEmptyString,
	reviewed: Schema.Boolean,
})
export type SessionReviewFile = typeof SessionReviewFile.Type

export const ProjectedSessionReviewState = Schema.Struct({
	sequence: Sequence,
	sessionId: SessionId,
	files: Schema.Array(SessionReviewFile),
})
export type ProjectedSessionReviewState = typeof ProjectedSessionReviewState.Type

export const emptyProjectedSessionReviewState = (
	sessionId: SessionId,
	sequence: Sequence,
): ProjectedSessionReviewState => ({
	sequence,
	sessionId,
	files: [],
})
