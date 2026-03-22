<script lang="ts">
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "$lib/components/ui/select/index.js";

import type { SupportedLanguage } from "../locale.js";
import { getLocale, setLocale } from "../store.svelte.js";
import { formatLanguageName, getLanguageMetadata, getLanguageMetadataByCode } from "../utils.js";
import TranslationBranding from "./translation-branding.svelte";

const languages = getLanguageMetadata();
let currentLocale = $state(getLocale());

const currentLanguageName = $derived(
	getLanguageMetadataByCode(currentLocale)
		? formatLanguageName(getLanguageMetadataByCode(currentLocale)!, true)
		: "Select language"
);

// Handle locale change via Select's onValueChange
function handleLocaleChange(value: string) {
	const locale = value as SupportedLanguage;
	currentLocale = locale;
	setLocale(locale);
}
</script>

<div class="flex items-center gap-4">
	<TranslationBranding />
	<Select value={currentLocale} onValueChange={handleLocaleChange} type="single">
		<SelectTrigger class="w-[200px]">
			{currentLanguageName}
		</SelectTrigger>
		<SelectContent>
			{#each languages as language (language.code)}
				<SelectItem value={language.code} label={formatLanguageName(language, true)}>
					{formatLanguageName(language, true)}
				</SelectItem>
			{/each}
		</SelectContent>
	</Select>
</div>
