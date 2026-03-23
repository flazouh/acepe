export type ModelMetadata = {
	name?: string;
	description?: string;
	contextWindow?: number;
	costPer1kInputTokens?: number;
	costPer1kOutputTokens?: number;
	[key: string]: unknown;
};
