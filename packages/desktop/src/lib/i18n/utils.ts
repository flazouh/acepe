import type { SupportedLanguage } from "./locale.js";

/**
 * Language metadata for display purposes
 */
export interface LanguageMetadata {
	code: SupportedLanguage;
	name: string;
	nativeName: string;
}

/**
 * Get language metadata for all supported languages
 */
export function getLanguageMetadata(): LanguageMetadata[] {
	return [
		{ code: "en", name: "English", nativeName: "English" },
		{ code: "af", name: "Afrikaans", nativeName: "Afrikaans" },
		{ code: "am", name: "Amharic", nativeName: "አማርኛ" },
		{ code: "ar", name: "Arabic", nativeName: "العربية" },
		{ code: "az", name: "Azerbaijani", nativeName: "Azərbaycan" },
		{ code: "be", name: "Belarusian", nativeName: "Беларуская" },
		{ code: "bg", name: "Bulgarian", nativeName: "Български" },
		{ code: "bn", name: "Bengali", nativeName: "বাংলা" },
		{ code: "bs", name: "Bosnian", nativeName: "Bosanski" },
		{ code: "ca", name: "Catalan", nativeName: "Català" },
		{ code: "cs", name: "Czech", nativeName: "Čeština" },
		{ code: "da", name: "Danish", nativeName: "Dansk" },
		{ code: "de", name: "German", nativeName: "Deutsch" },
		{ code: "el", name: "Greek", nativeName: "Ελληνικά" },
		{ code: "es", name: "Spanish", nativeName: "Español" },
		{ code: "et", name: "Estonian", nativeName: "Eesti" },
		{ code: "fa", name: "Persian", nativeName: "فارسی" },
		{ code: "fi", name: "Finnish", nativeName: "Suomi" },
		{ code: "fil", name: "Filipino", nativeName: "Filipino" },
		{ code: "fr", name: "French", nativeName: "Français" },
		{ code: "gl", name: "Galician", nativeName: "Galego" },
		{ code: "gu", name: "Gujarati", nativeName: "ગુજરાતી" },
		{ code: "he", name: "Hebrew", nativeName: "עברית" },
		{ code: "hi", name: "Hindi", nativeName: "हिन्दी" },
		{ code: "hr", name: "Croatian", nativeName: "Hrvatski" },
		{ code: "hu", name: "Hungarian", nativeName: "Magyar" },
		{ code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
		{ code: "it", name: "Italian", nativeName: "Italiano" },
		{ code: "ja", name: "Japanese", nativeName: "日本語" },
		{ code: "ka", name: "Georgian", nativeName: "ქართული" },
		{ code: "kk", name: "Kazakh", nativeName: "Қазақ" },
		{ code: "km", name: "Khmer", nativeName: "ខ្មែរ" },
		{ code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ" },
		{ code: "ko", name: "Korean", nativeName: "한국어" },
		{ code: "ky", name: "Kyrgyz", nativeName: "Кыргызча" },
		{ code: "lo", name: "Lao", nativeName: "ລາວ" },
		{ code: "lt", name: "Lithuanian", nativeName: "Lietuvių" },
		{ code: "lv", name: "Latvian", nativeName: "Latviešu" },
		{ code: "mk", name: "Macedonian", nativeName: "Македонски" },
		{ code: "ml", name: "Malayalam", nativeName: "മലയാളം" },
		{ code: "mn", name: "Mongolian", nativeName: "Монгол" },
		{ code: "mr", name: "Marathi", nativeName: "मराठी" },
		{ code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
		{ code: "my", name: "Myanmar", nativeName: "မြန်မာ" },
		{ code: "ne", name: "Nepali", nativeName: "नेपाली" },
		{ code: "nl", name: "Dutch", nativeName: "Nederlands" },
		{ code: "no", name: "Norwegian", nativeName: "Norsk" },
		{ code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
		{ code: "pl", name: "Polish", nativeName: "Polski" },
		{ code: "pt", name: "Portuguese", nativeName: "Português" },
		{ code: "ro", name: "Romanian", nativeName: "Română" },
		{ code: "ru", name: "Russian", nativeName: "Русский" },
		{ code: "si", name: "Sinhala", nativeName: "සිංහල" },
		{ code: "sk", name: "Slovak", nativeName: "Slovenčina" },
		{ code: "sl", name: "Slovenian", nativeName: "Slovenščina" },
		{ code: "sq", name: "Albanian", nativeName: "Shqip" },
		{ code: "sr", name: "Serbian", nativeName: "Српски" },
		{ code: "sv", name: "Swedish", nativeName: "Svenska" },
		{ code: "sw", name: "Swahili", nativeName: "Kiswahili" },
		{ code: "ta", name: "Tamil", nativeName: "தமிழ்" },
		{ code: "te", name: "Telugu", nativeName: "తెలుగు" },
		{ code: "th", name: "Thai", nativeName: "ไทย" },
		{ code: "tr", name: "Turkish", nativeName: "Türkçe" },
		{ code: "uk", name: "Ukrainian", nativeName: "Українська" },
		{ code: "ur", name: "Urdu", nativeName: "اردو" },
		{ code: "uz", name: "Uzbek", nativeName: "Oʻzbek" },
		{ code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
		{ code: "zh", name: "Chinese", nativeName: "中文" },
	];
}

/**
 * Get language metadata for a specific language code
 */
export function getLanguageMetadataByCode(code: SupportedLanguage): LanguageMetadata | undefined {
	return getLanguageMetadata().find((lang) => lang.code === code);
}

/**
 * Format language display name
 */
export function formatLanguageName(metadata: LanguageMetadata, showNative = true): string {
	if (showNative && metadata.nativeName !== metadata.name) {
		return `${metadata.name} (${metadata.nativeName})`;
	}
	return metadata.name;
}
