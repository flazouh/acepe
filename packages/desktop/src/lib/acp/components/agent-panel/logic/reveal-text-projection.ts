// Reveal-text projection — U2/U3 of the display-model retirement plan
// (docs/plans/2026-06-09-001-refactor-retire-agent-panel-display-model-plan.md).
//
// Presentation-layer projector that holds the previously-visible assistant text
// when canonical markdown transiently blanks mid-turn (the "same-key running
// replacement" continuity), and snaps to canonical on completion. This is the
// reveal lifecycle's responsibility per
// docs/solutions/ui-bugs/assistant-text-reveal-streaming-block.md — it is NOT
// canonical state.
//
// GOD invariant (gate run 2026-06-09): this is a render-time presentation
// override. It reads the materializer's scene `markdown` + transient turn
// context and returns continuity-corrected scene entries; it never mutates the
// materializer's output objects and never writes canonical data.
//
// It emits a RevealScenePatch (U3) describing the same-length index-overrides it
// made, so token-reveal-scene-read-model and graph-scene-entry-index keep their
// incremental fast-path. Built and unit-tested in isolation; it goes live in the
// controller at U4 when the scene -> display -> scene round-trip is removed and
// the display-model's copy of this logic is deleted (single live authority).

import type { AgentAssistantEntry, AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { createDisplayedAssistantMessage } from "./agent-panel-display-model-assistant-content.js";
import { createPatchedSceneEntriesArray } from "./scene-entry-array-view.js";
import {
	buildRevealScenePatchResult,
	type RevealTextProjectionResult,
} from "./reveal-scene-patch.js";
import { scenePatchIdentity } from "./scene-patch.js";

export interface RevealTextProjectionSnapshot {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly sessionId: string | null;
	readonly turnId: string | null;
	/** True when the canonical turn has reached a terminal/completed state. */
	readonly turnCompleted: boolean;
}

export interface RevealTextProjection {
	apply(snapshot: RevealTextProjectionSnapshot): RevealTextProjectionResult;
}

// Faithful port of applyDisplayTextToRow's assistant branch
// (agent-panel-display-model.ts): snap to canonical on completion; otherwise
// hold the previously-visible text only when canonical has transiently emptied.
function projectVisibleText(
	canonicalMarkdown: string,
	previousVisible: string,
	turnCompleted: boolean
): string {
	if (turnCompleted) {
		return canonicalMarkdown;
	}
	if (canonicalMarkdown.length === 0 && previousVisible.length > 0) {
		return previousVisible;
	}
	return canonicalMarkdown;
}

function applyVisibleTextToAssistantEntry(
	entry: AgentAssistantEntry,
	visibleText: string
): AgentAssistantEntry {
	return {
		id: entry.id,
		type: "assistant",
		markdown: visibleText,
		message:
			entry.message === undefined
				? undefined
				: createDisplayedAssistantMessage(entry.message, visibleText),
		isStreaming: entry.isStreaming,
		tokenRevealCss: entry.tokenRevealCss,
		timestampMs: entry.timestampMs,
	};
}

export function createRevealTextProjection(): RevealTextProjection {
	let memoryKeySessionId: string | null = null;
	let memoryKeyTurnId: string | null = null;
	let visibleTextByRowId = new Map<string, string>();
	let lastInput: readonly AgentPanelSceneEntryModel[] | null = null;
	let lastTurnCompleted = false;
	let previousOutput: RevealTextProjectionResult | null = null;

	return {
		apply(snapshot) {
			const keyChanged =
				snapshot.sessionId !== memoryKeySessionId || snapshot.turnId !== memoryKeyTurnId;

			// Referential stability: identical input + same turn-completion + same
			// session/turn → return the prior output so downstream patch detection
			// (token-reveal) sees a no-op.
			if (
				!keyChanged &&
				previousOutput !== null &&
				lastInput === snapshot.sceneEntries &&
				lastTurnCompleted === snapshot.turnCompleted
			) {
				return previousOutput;
			}

			// Reset held text whenever the session or turn changes, so prior-turn
			// text never bleeds into a new turn.
			if (keyChanged) {
				memoryKeySessionId = snapshot.sessionId;
				memoryKeyTurnId = snapshot.turnId;
				visibleTextByRowId = new Map<string, string>();
			}

			const nextVisibleByRowId = new Map<string, string>();
			const patchedByIndex = new Map<number, AgentPanelSceneEntryModel>();
			const patchedEntries: AgentPanelSceneEntryModel[] = [];

			snapshot.sceneEntries.forEach((entry, index) => {
				if (entry.type !== "assistant") {
					return;
				}
				const previousVisible = visibleTextByRowId.get(entry.id) ?? "";
				const visibleText = projectVisibleText(
					entry.markdown,
					previousVisible,
					snapshot.turnCompleted
				);
				nextVisibleByRowId.set(entry.id, visibleText);
				if (visibleText === entry.markdown) {
					return;
				}
				const patched = applyVisibleTextToAssistantEntry(entry, visibleText);
				patchedByIndex.set(index, patched);
				patchedEntries.push(patched);
			});

			visibleTextByRowId = nextVisibleByRowId;

			const output =
				patchedByIndex.size === 0
					? {
							entries: snapshot.sceneEntries,
							scenePatch: scenePatchIdentity(),
						}
					: buildRevealScenePatchResult(
							snapshot.sceneEntries,
							patchedByIndex,
							createPatchedSceneEntriesArray(snapshot.sceneEntries, patchedByIndex)
						);

			lastInput = snapshot.sceneEntries;
			lastTurnCompleted = snapshot.turnCompleted;
			previousOutput = output;
			return output;
		},
	};
}
