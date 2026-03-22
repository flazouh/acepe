import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";

/**
 * Get the system locale from the Tauri backend
 * @returns ResultAsync containing the locale string (e.g., "en-US", "es-ES")
 */
export function getSystemLocale(): ResultAsync<string, Error> {
	return ResultAsync.fromPromise(
		invoke<string>("get_system_locale"),
		(error) => new Error(`Failed to get system locale: ${String(error)}`)
	);
}

/**
 * Normalize locale to a language tag (e.g., "en-US" -> "en")
 * @param locale - The locale string from the system
 * @returns The language tag
 */
export function normalizeLocaleToLanguageTag(locale: string): string {
	// Extract the language part before the hyphen
	const languageTag = locale.split("-")[0].toLowerCase();
	return languageTag;
}

/**
 * Get supported language tags (52 Chrome languages)
 */
export const SUPPORTED_LANGUAGES = [
	"en",
	"af",
	"am",
	"ar",
	"az",
	"be",
	"bg",
	"bn",
	"bs",
	"ca",
	"cs",
	"da",
	"de",
	"el",
	"es",
	"et",
	"fa",
	"fi",
	"fil",
	"fr",
	"gl",
	"gu",
	"he",
	"hi",
	"hr",
	"hu",
	"id",
	"it",
	"ja",
	"ka",
	"kk",
	"km",
	"kn",
	"ko",
	"ky",
	"lo",
	"lt",
	"lv",
	"mk",
	"ml",
	"mn",
	"mr",
	"ms",
	"my",
	"ne",
	"nl",
	"no",
	"pa",
	"pl",
	"pt",
	"ro",
	"ru",
	"si",
	"sk",
	"sl",
	"sq",
	"sr",
	"sv",
	"sw",
	"ta",
	"te",
	"th",
	"tr",
	"uk",
	"ur",
	"uz",
	"vi",
	"zh",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Check if a language tag is supported
 */
export function isSupportedLanguage(languageTag: string): languageTag is SupportedLanguage {
	return SUPPORTED_LANGUAGES.includes(languageTag as SupportedLanguage);
}

/**
 * Get a fallback language if the provided one is not supported
 */
export function getFallbackLanguage(languageTag: string): SupportedLanguage {
	return isSupportedLanguage(languageTag) ? languageTag : "en";
}
