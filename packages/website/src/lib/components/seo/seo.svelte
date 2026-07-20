<script lang="ts">
import { page } from "$app/state";
import { canonicalizePathname } from "$lib/locale-routing";

const BASE_URL = "https://acepe.dev";
const DEFAULT_IMAGE = "/og-image.png";
const DEFAULT_IMAGE_ALT = "Acepe — The Agentic Developer Environment";

interface SeoProps {
	title: string;
	description: string;
	type?: "website" | "article" | "product" | "profile";
	image?: string;
	imageAlt?: string;
	imageWidth?: number;
	imageHeight?: number;
	noindex?: boolean;
	canonical?: string;
	publishedTime?: string;
	modifiedTime?: string;
	author?: string;
	keywords?: readonly string[];
	jsonLd?: object | readonly object[];
}

let {
	title,
	description,
	type = "website",
	image = DEFAULT_IMAGE,
	imageAlt = DEFAULT_IMAGE_ALT,
	imageWidth,
	imageHeight,
	noindex = false,
	canonical,
	publishedTime,
	modifiedTime,
	author,
	keywords,
	jsonLd,
}: SeoProps = $props();

const titleSuffix = " — Acepe";
const fullTitle = $derived(
	title === "Acepe" || title.endsWith(titleSuffix) || title.endsWith("- Acepe")
		? title
		: `${title}${titleSuffix}`
);

const canonicalPath = $derived(canonical ?? canonicalizePathname(page.url?.pathname ?? "/"));
const canonicalUrl = $derived(
	canonicalPath.startsWith("http") ? canonicalPath : `${BASE_URL}${canonicalPath}`
);

const absoluteImage = $derived.by((): string => {
	if (image.startsWith("http")) return image;
	const normalized = image.startsWith("/") ? image : `/${image}`;
	return `${BASE_URL}${normalized}`;
});

// Only declare og:image dimensions when we know them. The default OG image
// is 1200x630; custom callers may supply their own dimensions. Lying about
// dimensions causes incorrect cropping in social link previews.
const isDefaultImage = $derived(image === DEFAULT_IMAGE);
const declaredImageWidth = $derived(imageWidth ?? (isDefaultImage ? 1200 : undefined));
const declaredImageHeight = $derived(imageHeight ?? (isDefaultImage ? 630 : undefined));

const robotsContent = $derived(
	noindex
		? "noindex, nofollow"
		: "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
);

const keywordsContent = $derived(keywords?.join(", "));

const jsonLdScripts = $derived.by((): readonly string[] => {
	if (!jsonLd) return [];
	const arr = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
	return arr.map((schema) => JSON.stringify(schema));
});
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<meta name="robots" content={robotsContent} />
	<meta name="googlebot" content={robotsContent} />
	{#if keywordsContent}
		<meta name="keywords" content={keywordsContent} />
	{/if}
	{#if author}
		<meta name="author" content={author} />
	{/if}
	<link rel="canonical" href={canonicalUrl} />

	<meta property="og:type" content={type} />
	<meta property="og:site_name" content="Acepe" />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={absoluteImage} />
	<meta property="og:image:alt" content={imageAlt} />
	{#if declaredImageWidth !== undefined && declaredImageHeight !== undefined}
		<meta property="og:image:width" content={String(declaredImageWidth)} />
		<meta property="og:image:height" content={String(declaredImageHeight)} />
	{/if}
	<meta property="og:locale" content="en_US" />
	{#if publishedTime}
		<meta property="article:published_time" content={publishedTime} />
	{/if}
	{#if modifiedTime}
		<meta property="article:modified_time" content={modifiedTime} />
	{/if}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={absoluteImage} />
	<meta name="twitter:image:alt" content={imageAlt} />

	{#each jsonLdScripts as script (script)}
		{@html `<script type="application/ld+json">${script}<\/script>`}
	{/each}
</svelte:head>
