import type { Model } from "../../../application/dto/model.js";
import type { AvailableMode } from "../../../types/available-mode.js";

import { CanonicalModeId } from "../../../types/canonical-mode-id.js";

interface ResolveToolbarModeIdInput {
	readonly liveCurrentModeId: string | null;
	readonly provisionalModeId: string | null;
	readonly visibleModes: readonly AvailableMode[];
}

interface ResolveToolbarModelIdInput {
	readonly liveCurrentModelId: string | null;
	readonly provisionalModelId: string | null;
	readonly availableModels: readonly Model[];
	readonly preferredDefaultModelId: string | null;
}

interface ResolvePendingToolbarSelectionsInput {
	readonly provisionalModeId: string | null;
	readonly provisionalModelId: string | null;
	readonly liveCurrentModeId: string | null;
	readonly liveCurrentModelId: string | null;
	readonly availableModes: readonly AvailableMode[];
	readonly availableModels: readonly Model[];
}

interface PendingToolbarSelectionsResolution {
	readonly modeIdToApply: string | null;
	readonly modelIdToApply: string | null;
	readonly nextProvisionalModeId: string | null;
	readonly nextProvisionalModelId: string | null;
}

export function resolveToolbarModeId(input: ResolveToolbarModeIdInput): string | null {
	const { liveCurrentModeId, provisionalModeId, visibleModes } = input;
	const visibleModeIds = new Set(visibleModes.map((mode) => mode.id));

	if (liveCurrentModeId && visibleModeIds.has(liveCurrentModeId)) {
		return liveCurrentModeId;
	}

	if (provisionalModeId && visibleModeIds.has(provisionalModeId)) {
		return provisionalModeId;
	}

	if (visibleModeIds.has(CanonicalModeId.BUILD)) {
		return CanonicalModeId.BUILD;
	}

	return visibleModes[0]?.id ?? null;
}

export function resolveToolbarModelId(input: ResolveToolbarModelIdInput): string | null {
	const { liveCurrentModelId, provisionalModelId, availableModels, preferredDefaultModelId } =
		input;
	const availableModelIds = new Set(availableModels.map((model) => model.id));

	if (liveCurrentModelId && availableModelIds.has(liveCurrentModelId)) {
		return liveCurrentModelId;
	}

	if (provisionalModelId && availableModelIds.has(provisionalModelId)) {
		return provisionalModelId;
	}

	if (preferredDefaultModelId && availableModelIds.has(preferredDefaultModelId)) {
		return preferredDefaultModelId;
	}

	return availableModels[0]?.id ?? null;
}

export function resolvePendingToolbarSelections(
	input: ResolvePendingToolbarSelectionsInput
): PendingToolbarSelectionsResolution {
	const {
		provisionalModeId,
		provisionalModelId,
		liveCurrentModeId,
		liveCurrentModelId,
		availableModes,
		availableModels,
	} = input;

	const validModeIds = new Set(availableModes.map((mode) => mode.id));
	const validModelIds = new Set(availableModels.map((model) => model.id));

	const nextProvisionalModeId =
		provisionalModeId && validModeIds.has(provisionalModeId) ? provisionalModeId : null;
	const nextProvisionalModelId =
		provisionalModelId && validModelIds.has(provisionalModelId) ? provisionalModelId : null;

	return {
		modeIdToApply:
			nextProvisionalModeId && nextProvisionalModeId !== liveCurrentModeId
				? nextProvisionalModeId
				: null,
		modelIdToApply:
			nextProvisionalModelId && nextProvisionalModelId !== liveCurrentModelId
				? nextProvisionalModelId
				: null,
		nextProvisionalModeId,
		nextProvisionalModelId,
	};
}
