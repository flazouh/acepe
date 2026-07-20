/**
 * Activation-timeline invariant — systematic guard for the "optimistic user
 * message disappears during session activation" regression.
 *
 * The agent panel composes three pure resolvers to decide what the conversation
 * shows during the first-send → session-created → canonical-transcript handoff:
 *
 *   1. deriveCanonicalUserEntryPresence  — is there a canonical user entry yet?
 *   2. resolveOptimisticUserEntryForGraph — which optimistic entry (if any) to overlay
 *   3. resolveVisibleEntryCount           — how many entries the panel believes it has
 *
 * `AgentPanelSessionController` wires them together exactly as `deriveDisplay`
 * below does (see agent-panel-session-controller.svelte.ts:
 * canonicalUserEntryPresence / optimisticUserEntryForGraph / visibleEntryCount).
 *
 * THE INVARIANT under test:
 *   While a user message is in flight — i.e. a panel-level pending entry OR a
 *   session-level pending-send-intent exists — and no canonical entry has yet
 *   superseded it, the panel's known visible entry count must be >= 1.
 *
 * If that invariant breaks at any step, the conversation collapses to an empty
 * "Planning next moves…" spinner with the user's message gone — exactly the
 * reported bug. Each step is labelled so a failure names the precise lifecycle
 * transition that drops the message.
 */
import { describe, expect, it } from "bun:test";
import type { TranscriptEntry } from "../../../../../services/acp-types.js";
import type { SessionEntry } from "../../../../application/dto/session-entry.js";
import {
	deriveCanonicalUserEntryPresence,
	resolveOptimisticUserEntryForGraph,
	resolveVisibleEntryCount,
} from "../optimistic-user-entry.js";

// --- fixtures -------------------------------------------------------------

function userEntry(id: string, text: string): SessionEntry {
	return {
		id,
		type: "user",
		message: {
			content: { type: "text", text },
			chunks: [{ type: "text", text }],
		},
	};
}

function canonicalUserEntry(entryId: string, attemptId: string | null): TranscriptEntry {
	return { entryId, role: "user", segments: [], attemptId };
}

// --- controller composition (mirror of AgentPanelSessionController) --------

/**
 * Raw store/panel readings at a single point in the activation lifecycle, keyed
 * to the panel's currently-bound sessionId. `null` transcript means "session
 * exists but its canonical transcript has not loaded yet" (distinct from `[]`,
 * which means "loaded, empty"). This distinction is the crux of the bug.
 */
interface LifecycleStep {
	readonly label: string;
	readonly boundSessionId: string | null;
	readonly panelPendingUserEntry: SessionEntry | null;
	readonly sessionPendingSendIntent: {
		readonly attemptId: string;
		readonly optimisticEntry: SessionEntry;
	} | null;
	readonly canonicalTranscriptEntries: readonly TranscriptEntry[] | null;
	/** True once a user message has been handed to the backend (send pressed). */
	readonly messageInFlight: boolean;
}

interface DisplayDerivation {
	readonly optimisticUserEntry: SessionEntry | null;
	readonly knownVisibleEntryCount: number;
}

/** Exact replica of the controller's derivation spine. */
function deriveDisplay(step: LifecycleStep): DisplayDerivation {
	const hasSession = step.boundSessionId !== null;

	// canonicalUserEntryPresence: transcript is [] when there is no session.
	const transcriptEntries = hasSession ? step.canonicalTranscriptEntries : [];
	const presence = deriveCanonicalUserEntryPresence({
		transcriptEntries,
		pendingAttemptId: step.sessionPendingSendIntent?.attemptId ?? null,
	});

	const optimisticUserEntry = resolveOptimisticUserEntryForGraph({
		panelPendingUserEntry: step.panelPendingUserEntry,
		sessionPendingOptimisticEntry: step.sessionPendingSendIntent?.optimisticEntry ?? null,
		hasCanonicalUserEntry: presence.hasCanonicalUserEntry,
		hasCanonicalMatchingPendingUserEntry: presence.hasCanonicalMatchingPendingUserEntry,
	});

	const canonicalEntryCount = hasSession ? (step.canonicalTranscriptEntries?.length ?? null) : 0;
	const visibleEntryCount = resolveVisibleEntryCount({
		canonicalEntryCount,
		canonicalMessageCount: canonicalEntryCount,
		optimisticUserEntry,
	});

	return {
		optimisticUserEntry,
		knownVisibleEntryCount: visibleEntryCount ?? 0,
	};
}

// --- timelines ------------------------------------------------------------

const MSG = "hello from QA test";
const ATTEMPT = "attempt-1";

/**
 * New-session first-send timeline. The deferred/eager creation path installs the
 * pending-send-intent under the requested (pending) sessionId, then promotes that
 * id to canonical. The store closes the gap at the promotion seam:
 * `migratePendingSendIntentAlias` moves the intent from the requested id to the
 * canonical id in the SAME tick it records the alias relationship (see
 * session-open-snapshot-applier.svelte.ts and session-messaging-service.ts).
 *
 * Because alias-registration and intent-migration are atomic, the panel never
 * observes a window where it is bound to the canonical id while the intent is
 * still keyed to the pending id. The step "promotion settled, intent migrated to
 * bound id" models that guarantee: the intent remains readable under whatever id
 * the panel is bound to, so the optimistic message stays visible throughout. This
 * is the regression that produced the ~14s empty "Planning next moves" spinner.
 */
function newSessionSendTimeline(): readonly LifecycleStep[] {
	const optimistic = userEntry("optimistic-1", MSG);
	return [
		{
			label: "send pressed, pre-session (panel optimistic only)",
			boundSessionId: null,
			panelPendingUserEntry: optimistic,
			sessionPendingSendIntent: null,
			canonicalTranscriptEntries: null,
			messageInFlight: true,
		},
		{
			label: "session bound, pending-send-intent readable, transcript loading",
			boundSessionId: "session-canonical",
			panelPendingUserEntry: optimistic,
			sessionPendingSendIntent: { attemptId: ATTEMPT, optimisticEntry: optimistic },
			canonicalTranscriptEntries: null,
			messageInFlight: true,
		},
		{
			label: "promotion settled, intent migrated to bound id, transcript loading",
			boundSessionId: "session-canonical",
			// Panel-level optimistic was cleared after the send resolved. The
			// session-level intent was keyed to the requested (pending) id, but
			// migratePendingSendIntentAlias moved it to the canonical id in the same
			// tick the alias was recorded — so it remains readable under the bound id.
			// This is the activation window that previously rendered empty.
			panelPendingUserEntry: null,
			sessionPendingSendIntent: { attemptId: ATTEMPT, optimisticEntry: optimistic },
			canonicalTranscriptEntries: null,
			messageInFlight: true,
		},
		{
			label: "canonical transcript loaded empty, awaiting model",
			boundSessionId: "session-canonical",
			panelPendingUserEntry: null,
			sessionPendingSendIntent: { attemptId: ATTEMPT, optimisticEntry: optimistic },
			canonicalTranscriptEntries: [],
			messageInFlight: true,
		},
		{
			label: "canonical user entry landed (matching attempt)",
			boundSessionId: "session-canonical",
			panelPendingUserEntry: null,
			sessionPendingSendIntent: { attemptId: ATTEMPT, optimisticEntry: optimistic },
			canonicalTranscriptEntries: [canonicalUserEntry("user-1", ATTEMPT)],
			messageInFlight: false,
		},
	];
}

/**
 * Resume timeline (control): reopening an existing session with NO message in
 * flight. Here a momentary zero visible-entry count while the transcript loads
 * is correct — there is nothing optimistic to preserve. The invariant must NOT
 * fire here, which keeps any fix from over-showing stale entries on resume.
 */
function resumeTimeline(): readonly LifecycleStep[] {
	return [
		{
			label: "reopen, transcript loading (nothing in flight)",
			boundSessionId: "session-existing",
			panelPendingUserEntry: null,
			sessionPendingSendIntent: null,
			canonicalTranscriptEntries: null,
			messageInFlight: false,
		},
		{
			label: "transcript loaded with prior history",
			boundSessionId: "session-existing",
			panelPendingUserEntry: null,
			sessionPendingSendIntent: null,
			canonicalTranscriptEntries: [canonicalUserEntry("user-prev", null)],
			messageInFlight: false,
		},
	];
}

// --- assertions -----------------------------------------------------------

describe("activation-timeline invariant", () => {
	describe("new-session first send keeps the user message visible throughout", () => {
		for (const step of newSessionSendTimeline()) {
			it(`step: ${step.label}`, () => {
				const display = deriveDisplay(step);
				if (step.messageInFlight) {
					expect(display.knownVisibleEntryCount).toBeGreaterThanOrEqual(1);
				}
			});
		}
	});

	describe("resume with nothing in flight does not over-show entries", () => {
		for (const step of resumeTimeline()) {
			it(`step: ${step.label}`, () => {
				const display = deriveDisplay(step);
				// No message in flight: a transient 0 while loading is acceptable, and
				// we must never fabricate an optimistic entry from thin air.
				if (step.panelPendingUserEntry === null && step.sessionPendingSendIntent === null) {
					expect(display.optimisticUserEntry).toBeNull();
				}
			});
		}
	});
});
