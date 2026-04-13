<script lang="ts">
	import { page } from "$app/state";
	import { canonicalizePathname } from "$lib/locale-routing";

	const baseUrl = "https://acepe.dev";
	const canonicalPath = $derived(canonicalizePathname(page.url.pathname));

	const canonicalUrl = $derived(`${baseUrl}${canonicalPath}`);
</script>

<svelte:head>
	<link rel="canonical" href={canonicalUrl} />
</svelte:head>
