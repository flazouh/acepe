/**
 * Deriving a scenario's snapshots from its events.
 *
 * The session scope comes from `applyEventToRpcSessionSnapshot`, the fold the
 * app already trusts. The library scope does not: that fold carries the project
 * and session rows through untouched, so a scenario that expects the sidebar to
 * show something states those rows itself.
 */

import {
	type RpcProjectedProject,
	type RpcProjectedSession,
	type RpcSessionSnapshot,
	applyEventToRpcSessionSnapshot,
	emptyRpcSessionSnapshot,
} from "@acepe/contracts"
import type { QaScenarioStepLine } from "./scenario.ts"

/** The canonical fold, run over a scenario's steps. */
export const foldSessionSnapshot = (
	steps: ReadonlyArray<QaScenarioStepLine>,
): RpcSessionSnapshot => {
	let snapshot = emptyRpcSessionSnapshot(0)
	for (const step of steps) {
		snapshot = applyEventToRpcSessionSnapshot(snapshot, step.event)
	}
	return snapshot
}

export const librarySnapshot = (
	steps: ReadonlyArray<QaScenarioStepLine>,
	projects: ReadonlyArray<RpcProjectedProject>,
	sessions: ReadonlyArray<RpcProjectedSession>,
): RpcSessionSnapshot => {
	const folded = foldSessionSnapshot(steps)
	const knownSessions: ReadonlyArray<RpcProjectedSession> =
		sessions.length > 0 || folded.session === null ? sessions : [folded.session]
	return {
		snapshotSequence: folded.snapshotSequence,
		session: null,
		messages: [],
		turns: [],
		activities: [],
		pendingApprovals: [],
		checkpoints: [],
		projects,
		sessions: knownSessions,
		settings: [],
		skillsCatalog: null,
		voice: null,
		gitReview: null,
		mcpCatalog: null,
		preconnectionOptions: null,
		terminal: null,
		sessionReviewState: null,
	}
}
