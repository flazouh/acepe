<script lang="ts">
	import { page } from '$app/state';
	import { locales, baseLocale, localizeHref } from '$lib/paraglide/runtime';

	const baseUrl = 'https://acepe.dev';

	const currentPath = $derived(page.url.pathname);

	const hreflangs = $derived(
		locales.map((locale) => ({
			locale,
			href: `${baseUrl}${localizeHref(currentPath, { locale })}`
		}))
	);

	const defaultHref = $derived(`${baseUrl}${localizeHref(currentPath, { locale: baseLocale })}`);
</script>

<svelte:head>
	{#each hreflangs as { locale, href }}
		<link rel="alternate" hreflang={locale} {href} />
	{/each}
	<link rel="alternate" hreflang="x-default" href={defaultHref} />
</svelte:head>
