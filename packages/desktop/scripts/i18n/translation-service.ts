/**
 * Translation service using OpenRouter API
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { DEFAULT_CONFIG, getGlossaryForLanguage } from "./config";
import type { OpenRouterMessage, OpenRouterResponse, TranslationConfig } from "./types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export class TranslationService {
	private readonly apiKey: string;
	private readonly config: TranslationConfig;

	constructor(apiKey: string, config: Partial<TranslationConfig> = {}) {
		this.apiKey = apiKey;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Build the translation prompt for a batch of keys
	 */
	private buildPrompt(
		keysToTranslate: Record<string, string>,
		langCode: string,
		langName: string,
		existingTranslations: Record<string, string>
	): string {
		const glossary = getGlossaryForLanguage(langCode);

		const existingExamples =
			Object.keys(existingTranslations).length > 0
				? Object.entries(existingTranslations)
						.map(([k, v]) => `"${k}": "${v}"`)
						.join("\n")
				: "";

		return `Translate the following UI strings from English to ${langName} for a desktop application called "Acepe" - an AI agent client that helps developers interact with AI coding assistants like Claude.

Context:
- This is a professional desktop app for software developers
- Keep translations concise and natural for UI elements (buttons, labels, messages)
- Preserve any placeholders like {variable} exactly as-is
- Match the tone and style of existing translations
- Use formal/professional language appropriate for developer tools
${glossary ? `\nTerminology glossary (use these exact translations for consistency):\n${glossary}` : ""}
${existingExamples ? `\nExisting translations for style reference:\n${existingExamples}` : ""}

IMPORTANT: Respond with ONLY valid JSON object, no markdown, no explanation, no code blocks.

Translate these keys:
${JSON.stringify(keysToTranslate, null, 2)}`;
	}

	/**
	 * Call OpenRouter API with retry logic
	 */
	private callOpenRouter(messages: OpenRouterMessage[]): ResultAsync<OpenRouterResponse, Error> {
		const makeRequest = (): Promise<OpenRouterResponse> =>
			fetch(OPENROUTER_API_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://acepe.dev",
					"X-Title": "Acepe i18n Translation",
				},
				body: JSON.stringify({
					model: this.config.model,
					messages,
					max_tokens: 4096,
					temperature: 0.3, // Lower temperature for more consistent translations
				}),
			}).then(async (response) => {
				if (!response.ok) {
					const errorBody = await response.text();
					throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
				}
				return response.json() as Promise<OpenRouterResponse>;
			});

		return this.withRetry(
			() =>
				ResultAsync.fromPromise(
					makeRequest(),
					(error) =>
						new Error(
							`OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`
						)
				),
			this.config.maxRetries
		);
	}

	/**
	 * Retry wrapper with exponential backoff
	 */
	private withRetry<T>(
		fn: () => ResultAsync<T, Error>,
		retriesLeft: number
	): ResultAsync<T, Error> {
		return fn().orElse((error) => {
			if (retriesLeft <= 0) {
				return errAsync(error);
			}

			const delay = this.config.retryDelayMs * (this.config.maxRetries - retriesLeft + 1);

			return ResultAsync.fromPromise(
				new Promise((resolve) => setTimeout(resolve, delay)),
				() => error
			).andThen(() => this.withRetry(fn, retriesLeft - 1));
		});
	}

	/**
	 * Parse translation response from LLM
	 */
	private parseTranslationResponse(content: string): ResultAsync<Record<string, string>, Error> {
		// Clean up response - remove potential markdown code blocks
		let jsonText = content.trim();

		if (jsonText.startsWith("```")) {
			jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}

		// Remove any leading/trailing whitespace after cleanup
		jsonText = jsonText.trim();

		// Wrap JSON.parse in Promise to convert synchronous throws to async errors
		return ResultAsync.fromPromise(
			Promise.resolve().then(() => JSON.parse(jsonText) as Record<string, string>),
			(error) =>
				new Error(
					`Failed to parse translation response: ${error instanceof Error ? error.message : String(error)}. Response was: ${content.substring(0, 200)}...`
				)
		).andThen((parsed) => {
			// Validate that all values are strings
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value !== "string") {
					return errAsync(new Error(`Invalid translation value for key "${key}": expected string`));
				}
			}

			return okAsync(parsed);
		});
	}

	/**
	 * Translate a batch of keys to a target language
	 */
	translateBatch(
		keysToTranslate: Record<string, string>,
		langCode: string,
		langName: string,
		existingTranslations: Record<string, string>
	): ResultAsync<Record<string, string>, Error> {
		const prompt = this.buildPrompt(keysToTranslate, langCode, langName, existingTranslations);

		const messages: OpenRouterMessage[] = [
			{
				role: "system",
				content:
					"You are a professional translator specializing in software UI localization. You translate accurately while maintaining natural, idiomatic language. You always respond with valid JSON only, no explanations.",
			},
			{ role: "user", content: prompt },
		];

		return this.callOpenRouter(messages).andThen((response) => {
			const content = response.choices[0]?.message?.content;

			if (!content) {
				return errAsync(new Error("Empty response from OpenRouter"));
			}

			return this.parseTranslationResponse(content);
		});
	}

	/**
	 * Translate all keys in batches
	 */
	translateAllBatches(
		keysToTranslate: Record<string, string>,
		langCode: string,
		langName: string,
		existingTranslations: Record<string, string>,
		onBatchComplete?: (translated: number, total: number) => void
	): ResultAsync<Record<string, string>, Error> {
		const keys = Object.keys(keysToTranslate);
		const totalKeys = keys.length;

		if (totalKeys === 0) {
			return okAsync({});
		}

		const batches: Record<string, string>[] = [];
		for (let i = 0; i < keys.length; i += this.config.batchSize) {
			const batchKeys = keys.slice(i, i + this.config.batchSize);
			const batch: Record<string, string> = {};
			for (const key of batchKeys) {
				batch[key] = keysToTranslate[key];
			}
			batches.push(batch);
		}

		// Process batches sequentially to avoid rate limits
		let allTranslations: Record<string, string> = {};
		let processedCount = 0;

		const processBatch = (batchIndex: number): ResultAsync<Record<string, string>, Error> => {
			if (batchIndex >= batches.length) {
				return okAsync(allTranslations);
			}

			const batch = batches[batchIndex];

			return this.translateBatch(batch, langCode, langName, existingTranslations).andThen(
				(translations) => {
					allTranslations = { ...allTranslations, ...translations };
					processedCount += Object.keys(batch).length;

					if (onBatchComplete) {
						onBatchComplete(processedCount, totalKeys);
					}

					// Small delay between batches to avoid rate limits
					return ResultAsync.fromPromise(
						new Promise((resolve) => setTimeout(resolve, 100)),
						() => new Error("Delay failed")
					).andThen(() => processBatch(batchIndex + 1));
				}
			);
		};

		return processBatch(0);
	}
}
