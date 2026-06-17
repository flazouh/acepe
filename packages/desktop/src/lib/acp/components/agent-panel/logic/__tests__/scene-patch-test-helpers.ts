import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import { scenePatchIdentity, type ScenePatch } from "../scene-patch.js";
import type { TokenRevealSceneSnapshot } from "../token-reveal-scene-read-model.js";

export function withIdentityScenePatch(
	snapshot: Omit<TokenRevealSceneSnapshot, "scenePatch">
): TokenRevealSceneSnapshot {
	return {
		sceneEntries: snapshot.sceneEntries,
		scenePatch: scenePatchIdentity(),
		sourceEntry: snapshot.sourceEntry,
		tailRowId: snapshot.tailRowId,
		tailRowIndex: snapshot.tailRowIndex,
		tokenRevealCss: snapshot.tokenRevealCss,
	};
}

export function readConversationScenePatch(
	conversation: { scenePatch: ScenePatch }
): ScenePatch {
	return conversation.scenePatch;
}

export function scenePatchKind(
	scenePatch: ScenePatch
): ScenePatch["kind"] {
	return scenePatch.kind;
}

export function graphSceneAppendBaseEntries(
	scenePatch: ScenePatch
): readonly AgentPanelSceneEntryModel[] | undefined {
	return scenePatch.kind === "graphSceneAppend" ? scenePatch.patch.baseSceneEntries : undefined;
}
