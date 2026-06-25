export interface AgentInputVoiceModel {
	id: string;
	name: string;
	sizeBytes: number;
	isDownloaded: boolean;
}

export interface VoiceModelMenuRow {
	model: AgentInputVoiceModel;
	sizeLabel: string;
	isSelected: boolean;
	isDownloading: boolean;
}

const TIER_ORDER = ["tiny", "base", "small", "medium", "large"] as const;

function tierFor(modelId: string): string {
	const head = modelId.split(".")[0] ?? modelId;
	return head.toLowerCase();
}

export function compareVoiceModelsByTier(
	a: AgentInputVoiceModel,
	b: AgentInputVoiceModel
): number {
	const tierA = tierFor(a.id);
	const tierB = tierFor(b.id);
	const indexA = TIER_ORDER.indexOf(tierA as (typeof TIER_ORDER)[number]);
	const indexB = TIER_ORDER.indexOf(tierB as (typeof TIER_ORDER)[number]);
	const orderA = indexA === -1 ? TIER_ORDER.length : indexA;
	const orderB = indexB === -1 ? TIER_ORDER.length : indexB;
	if (orderA !== orderB) {
		return orderA - orderB;
	}
	return a.id.localeCompare(b.id);
}

export function formatVoiceModelSize(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function getVoiceModelRows({
	models,
	selectedModelId,
	downloadingModelId,
}: {
	models: readonly AgentInputVoiceModel[];
	selectedModelId: string | null;
	downloadingModelId: string | null;
}): VoiceModelMenuRow[] {
	const sortedModels = [...models].sort(compareVoiceModelsByTier);
	return sortedModels.map((model) => ({
		model,
		sizeLabel: formatVoiceModelSize(model.sizeBytes),
		isSelected: selectedModelId === model.id,
		isDownloading: downloadingModelId === model.id,
	}));
}
