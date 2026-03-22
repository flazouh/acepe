import { invoke } from "@tauri-apps/api/core";
import type { ResultAsync } from "neverthrow";

import { ResultAsync as NeverthrowResultAsync } from "neverthrow";
import type { UserSettingKey } from "$lib/services/converted-session-types.js";
// Paraglide runtime provides setLocale for locale switching
import { setLocale as setParaglideLocale } from "../paraglide/runtime.js";
import type { SupportedLanguage } from "./locale.js";
import { getFallbackLanguage, getSystemLocale, normalizeLocaleToLanguageTag } from "./locale.js";

const USER_LOCALE_KEY: UserSettingKey = "user_locale";

/**
 * Reactive locale store using Svelte 5 runes
 */
const localeState = $state<{
	currentLanguage: SupportedLanguage;
	isLoading: boolean;
	error: Error | null;
}>({
	currentLanguage: "en",
	isLoading: false,
	error: null,
});

/**
 * Initialize locale from system settings
 */
export function initializeLocale(): ResultAsync<void, Error> {
	localeState.isLoading = true;
	localeState.error = null;

	return getSystemLocale()
		.map((locale) => {
			const languageTag = normalizeLocaleToLanguageTag(locale);
			const supportedLanguage = getFallbackLanguage(languageTag);
			setLocale(supportedLanguage);
			localeState.isLoading = false;
		})
		.mapErr((error) => {
			localeState.error = error;
			localeState.isLoading = false;
			// Fallback to English on error
			setLocale("en");
			return error;
		});
}

/**
 * Set the current locale
 */
export function setLocale(language: SupportedLanguage): void {
	localeState.currentLanguage = language;
	setParaglideLocale(language);

	// Persist to database (fire-and-forget)
	NeverthrowResultAsync.fromPromise(
		invoke("save_user_setting", {
			key: USER_LOCALE_KEY,
			value: language,
		}),
		(e) => e as Error
	).mapErr(() => {
		// Ignore save errors
	});
}

/**
 * Get the current locale
 */
export function getLocale(): SupportedLanguage {
	return localeState.currentLanguage;
}

/**
 * Reactive getter for current language - use this to trigger re-renders when language changes
 */
export function getCurrentLanguage(): SupportedLanguage {
	return localeState.currentLanguage;
}

/**
 * Load locale from database on initialization
 */
export async function loadPersistedLocale(): Promise<void> {
	await NeverthrowResultAsync.fromPromise(
		invoke<string | null>("get_user_setting", {
			key: USER_LOCALE_KEY,
		}),
		(error) => error as Error
	)
		.map((persisted) => {
			if (persisted !== null && isSupportedLanguage(persisted)) {
				// Set locale without re-saving (it's already in DB)
				localeState.currentLanguage = persisted;
				setParaglideLocale(persisted);
			}
		})
		.mapErr(() => {
			// Ignore load errors
		});
}

function isSupportedLanguage(tag: string): tag is SupportedLanguage {
	const supported = [
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
	return supported.includes(tag as SupportedLanguage);
}
