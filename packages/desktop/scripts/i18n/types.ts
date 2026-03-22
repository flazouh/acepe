/**
 * Type definitions for i18n translation system
 */

export interface TranslationFile {
	$schema: string;
	[key: string]: string;
}

export interface TranslationResult {
	langCode: string;
	langName: string;
	translated: number;
	skipped: number;
	errors: string[];
}

export interface TranslationBatch {
	keys: Record<string, string>;
	langCode: string;
	langName: string;
}

export interface OpenRouterMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface OpenRouterResponse {
	id: string;
	choices: Array<{
		message: {
			content: string;
		};
		finish_reason: string;
	}>;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export interface TranslationConfig {
	model: string;
	batchSize: number;
	maxRetries: number;
	retryDelayMs: number;
}

export interface ProgressCallback {
	onLanguageStart: (langCode: string, langName: string) => void;
	onLanguageComplete: (result: TranslationResult) => void;
	onBatchComplete: (translated: number, total: number) => void;
	onError: (langCode: string, error: string) => void;
}
