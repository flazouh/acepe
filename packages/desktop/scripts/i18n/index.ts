#!/usr/bin/env bun

/**
 * Acepe i18n Translation Tool
 *
 * Translates UI strings from English to all supported languages
 * using Claude Haiku via OpenRouter for high-quality, consistent translations.
 *
 * Usage:
 *   bun run translate:haiku              # Translate missing keys
 *   bun run translate:haiku --all        # Re-translate all keys
 *   bun run translate:haiku --lang=fr    # Only translate French
 *   bun run translate:haiku --dry-run    # Preview without changes
 */

import { CLI } from "./cli";
import { getLanguageName } from "./config";
import { FileService } from "./file-service";
import { TranslationService } from "./translation-service";
import type { TranslationFile, TranslationResult } from "./types";

interface CLIOptions {
	forceAll: boolean;
	targetLang?: string;
	dryRun: boolean;
	showHelp: boolean;
}

function parseArgs(args: string[]): CLIOptions {
	return {
		forceAll: args.includes("--all"),
		targetLang: args.find((a) => a.startsWith("--lang="))?.split("=")[1],
		dryRun: args.includes("--dry-run"),
		showHelp: args.includes("--help") || args.includes("-h"),
	};
}

async function translateLanguage(
	translationService: TranslationService,
	fileService: FileService,
	cli: CLI,
	sourceData: TranslationFile,
	langCode: string,
	forceAll: boolean
): Promise<TranslationResult> {
	const langName = getLanguageName(langCode);
	const result: TranslationResult = {
		langCode,
		langName,
		translated: 0,
		skipped: 0,
		errors: [],
	};

	// Load or create target file
	const targetResult = await fileService.loadTranslationFile(langCode);
	let targetData: TranslationFile;

	if (targetResult.isErr()) {
		// Create new file if it doesn't exist
		const createResult = await fileService.createEmptyTranslationFile(langCode, sourceData.$schema);

		if (createResult.isErr()) {
			result.errors.push(createResult.error.message);
			return result;
		}

		targetData = createResult.value;
	} else {
		targetData = targetResult.value;
	}

	// Find keys that need translation
	const keysToTranslate = fileService.findMissingKeys(sourceData, targetData, forceAll);

	const keyCount = Object.keys(keysToTranslate).length;
	const totalKeys = Object.keys(sourceData).length - 1; // Exclude $schema

	if (keyCount === 0) {
		result.skipped = totalKeys;
		return result;
	}

	// Get existing translations for context
	const existingTranslations = fileService.getExistingTranslations(targetData, keysToTranslate);

	// Update spinner with progress
	cli.startSpinner(`Translating ${langCode} (${langName}): 0/${keyCount} keys...`);

	// Translate all batches
	const translationResult = await translationService.translateAllBatches(
		keysToTranslate,
		langCode,
		langName,
		existingTranslations,
		(translated, total) => {
			cli.updateSpinner(`Translating ${langCode} (${langName}): ${translated}/${total} keys...`);
		}
	);

	cli.stopSpinner();

	if (translationResult.isErr()) {
		result.errors.push(translationResult.error.message);
		return result;
	}

	const translations = translationResult.value;

	// Merge translations into target data
	for (const [key, value] of Object.entries(translations)) {
		targetData[key] = value;
	}

	// Save updated file
	const saveResult = await fileService.saveTranslationFile(langCode, targetData);

	if (saveResult.isErr()) {
		result.errors.push(saveResult.error.message);
		return result;
	}

	result.translated = Object.keys(translations).length;
	result.skipped = totalKeys - result.translated;

	return result;
}

async function main(): Promise<void> {
	const cli = new CLI();
	const options = parseArgs(process.argv.slice(2));

	if (options.showHelp) {
		cli.printHelp();
		process.exit(0);
	}

	// Check for API key (not required for dry-run)
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey && !options.dryRun) {
		cli.printHeader();
		cli.error("OPENROUTER_API_KEY environment variable is required");
		console.log("");
		console.log("  Set it with:");
		console.log("  export OPENROUTER_API_KEY=your-api-key");
		console.log("");
		process.exit(1);
	}

	// Initialize services
	const fileService = new FileService();
	const translationService = apiKey ? new TranslationService(apiKey) : null;

	cli.printHeader();

	// Load source translations
	cli.startSpinner("Loading source translations...");
	const sourceResult = await fileService.loadTranslationFile("en");

	if (sourceResult.isErr()) {
		cli.stopSpinner();
		cli.error(`Failed to load en.json: ${sourceResult.error.message}`);
		process.exit(1);
	}

	const sourceData = sourceResult.value;
	const sourceKeyCount = Object.keys(sourceData).length - 1;
	cli.stopSpinner();

	// Get target languages
	let languages: string[];
	if (options.targetLang) {
		languages = [options.targetLang];
	} else {
		const langResult = await fileService.getAvailableLanguages();

		if (langResult.isErr()) {
			cli.error(`Failed to get languages: ${langResult.error.message}`);
			process.exit(1);
		}

		languages = langResult.value;
	}

	// Print configuration
	cli.printConfig({
		sourceKeyCount,
		languageCount: languages.length,
		mode: options.forceAll
			? "Full re-translation"
			: options.dryRun
				? "Dry run (preview only)"
				: "Incremental (missing keys only)",
		targetLang: options.targetLang,
	});

	// Dry run mode
	if (options.dryRun) {
		cli.info("Dry run mode - no changes will be made\n");

		for (const langCode of languages) {
			const langName = getLanguageName(langCode);
			const targetResult = await fileService.loadTranslationFile(langCode);

			const targetData = targetResult.isOk() ? targetResult.value : { $schema: sourceData.$schema };

			const keysToTranslate = fileService.findMissingKeys(sourceData, targetData, options.forceAll);

			cli.printDryRun(langCode, langName, keysToTranslate);
		}

		console.log("");
		return;
	}

	// Translate each language
	console.log("  Translating:\n");
	const results: TranslationResult[] = [];

	if (!translationService) {
		cli.error("Translation service not initialized");
		process.exit(1);
	}

	for (const langCode of languages) {
		const result = await translateLanguage(
			translationService,
			fileService,
			cli,
			sourceData,
			langCode,
			options.forceAll
		);

		results.push(result);
		cli.printLanguageResult(result);
	}

	// Print summary
	cli.printSummary(results);

	// Exit with error if any translations failed
	const hasErrors = results.some((r) => r.errors.length > 0);
	if (hasErrors) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("\nFatal error:", error);
	process.exit(1);
});
