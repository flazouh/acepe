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
	return models.map((model) => ({
		model,
		sizeLabel: formatVoiceModelSize(model.sizeBytes),
		isSelected: selectedModelId === model.id,
		isDownloading: downloadingModelId === model.id,
	}));
}
