<script lang="ts">
import { getLocale, setLocale } from "$lib/i18n/store.svelte.js";
import { getLanguageMetadata } from "$lib/i18n/utils.js";
import * as m from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils.js";

interface Props {
	/** When true, parent provides the heading (e.g. settings page) */
	embedded?: boolean;
}

let { embedded = false }: Props = $props();

const languages = getLanguageMetadata();
let currentLocale = $state(getLocale());

function handleLanguageSelect(languageCode: string) {
	currentLocale = languageCode as typeof currentLocale;
	setLocale(languageCode as typeof currentLocale);
}
</script>

<div class="flex flex-col h-full text-sm">
	{#if !embedded}
		<div class="mb-3 shrink-0">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
				{m.settings_language_title()}
			</h2>
			<p class="text-sm text-muted-foreground/50 mt-1">
				{m.settings_language_description()}
			</p>
		</div>
	{/if}
	<div class="flex-1 min-h-0 flex flex-col">
		<h3
			class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 shrink-0"
		>
			{m.settings_supported_languages()}
		</h3>
		<div class="flex-1 min-h-0 overflow-auto rounded-lg border border-border/30">
			<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5">
				{#each languages as language (language.code)}
					<button
						type="button"
						onclick={() => handleLanguageSelect(language.code)}
						class={cn(
							"px-2.5 py-2 text-left transition-colors border-b border-r border-border/10",
							"hover:bg-muted/30",
							currentLocale === language.code
								? "bg-muted/50 text-foreground"
								: "text-muted-foreground"
						)}
					>
						<div class="text-sm font-medium">{language.name}</div>
						<div class="text-xs text-muted-foreground/40 mt-0.5">
							{language.nativeName}
						</div>
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>
