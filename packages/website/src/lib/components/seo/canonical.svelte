<script lang="ts">
import { page } from "$app/state";
import { baseLocale, getLocale, localizeHref } from "$lib/paraglide/runtime";

const baseUrl = "https://acepe.dev";
const locale = getLocale();

const canonicalPath = $derived(
	locale === baseLocale
		? page.url.pathname.replace(/\/$/, "") || "/"
		: localizeHref(page.url.pathname, { locale })
);

const canonicalUrl = $derived(
	`${baseUrl}${canonicalPath === "/" ? "/" : canonicalPath.replace(/\/$/, "")}`
);
</script>

<svelte:head>
	<link rel="canonical" href={canonicalUrl} />
</svelte:head>
