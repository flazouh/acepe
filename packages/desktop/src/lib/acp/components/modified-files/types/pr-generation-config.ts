/**
 * Configuration for the agent and model to use when generating PR content.
 */
export interface PrGenerationConfig {
	agentId?: string;
	modelId?: string;
	/** User-provided instructions layered ahead of the hidden response contract and diff context. */
	customPrompt?: string;
}
