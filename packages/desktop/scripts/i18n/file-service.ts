/**
 * File I/O service for translation files
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ResultAsync } from "neverthrow";

import type { TranslationFile } from "./types";

const MESSAGES_DIR = join(import.meta.dir, "../../messages");

export class FileService {
	private readonly messagesDir: string;

	constructor(messagesDir: string = MESSAGES_DIR) {
		this.messagesDir = messagesDir;
	}

	/**
	 * Load a translation file by language code
	 */
	loadTranslationFile(langCode: string): ResultAsync<TranslationFile, Error> {
		const filePath = join(this.messagesDir, `${langCode}.json`);

		return ResultAsync.fromPromise(
			readFile(filePath, "utf-8"),
			(error) =>
				new Error(
					`Failed to read ${langCode}.json: ${error instanceof Error ? error.message : String(error)}`
				)
		).andThen((content) => {
			// Wrap JSON.parse in Promise to convert synchronous throws to async errors
			return ResultAsync.fromPromise(
				Promise.resolve().then(() => JSON.parse(content) as TranslationFile),
				(error) =>
					new Error(
						`Failed to parse ${langCode}.json: ${error instanceof Error ? error.message : String(error)}`
					)
			);
		});
	}

	/**
	 * Save a translation file for a language code
	 */
	saveTranslationFile(langCode: string, data: TranslationFile): ResultAsync<void, Error> {
		const filePath = join(this.messagesDir, `${langCode}.json`);

		// Sort keys alphabetically, keeping $schema first
		const sortedData: TranslationFile = { $schema: data.$schema };
		const sortedKeys = Object.keys(data)
			.filter((k) => k !== "$schema")
			.sort();

		for (const key of sortedKeys) {
			sortedData[key] = data[key];
		}

		const content = `${JSON.stringify(sortedData, null, "\t")}\n`;

		return ResultAsync.fromPromise(
			writeFile(filePath, content, "utf-8"),
			(error) =>
				new Error(
					`Failed to write ${langCode}.json: ${error instanceof Error ? error.message : String(error)}`
				)
		);
	}

	/**
	 * Get list of available language codes (excluding English source)
	 */
	getAvailableLanguages(): ResultAsync<string[], Error> {
		return ResultAsync.fromPromise(
			readdir(this.messagesDir),
			(error) =>
				new Error(
					`Failed to read messages directory: ${error instanceof Error ? error.message : String(error)}`
				)
		).map((files) =>
			files
				.filter((f) => f.endsWith(".json") && f !== "en.json")
				.map((f) => f.replace(".json", ""))
				.sort()
		);
	}

	/**
	 * Create an empty translation file for a new language
	 */
	createEmptyTranslationFile(
		langCode: string,
		schema: string
	): ResultAsync<TranslationFile, Error> {
		const data: TranslationFile = { $schema: schema };
		return this.saveTranslationFile(langCode, data).map(() => data);
	}

	/**
	 * Find keys that need translation for a target language
	 */
	findMissingKeys(
		sourceData: TranslationFile,
		targetData: TranslationFile,
		forceAll: boolean
	): Record<string, string> {
		const keysToTranslate: Record<string, string> = {};

		for (const [key, value] of Object.entries(sourceData)) {
			if (key === "$schema") continue;

			const needsTranslation =
				forceAll ||
				!(key in targetData) ||
				targetData[key] === value || // Still in English (not translated)
				targetData[key] === "" ||
				targetData[key] === undefined;

			if (needsTranslation) {
				keysToTranslate[key] = value;
			}
		}

		return keysToTranslate;
	}

	/**
	 * Get existing translations for context (excluding keys being translated)
	 */
	getExistingTranslations(
		targetData: TranslationFile,
		keysToTranslate: Record<string, string>,
		limit: number = 10
	): Record<string, string> {
		const existing: Record<string, string> = {};
		let count = 0;

		for (const [key, value] of Object.entries(targetData)) {
			if (key === "$schema" || key in keysToTranslate) continue;
			if (count >= limit) break;

			existing[key] = value;
			count++;
		}

		return existing;
	}
}
