<script lang="ts">
const description =
	"A native desktop client for Claude Code, Codex, Cursor Agent, and any ACP-compatible AI agent. Same powerful agents, better interface.";

const sameAs = ["https://github.com/flazouh/acepe"];

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "Acepe",
	alternateName: "Acepe — The Agentic Developer Environment",
	url: "https://acepe.dev",
	logo: {
		"@type": "ImageObject",
		url: "https://acepe.dev/brand/acepe-a-512.png",
		width: 512,
		height: 512,
	},
	description,
	sameAs,
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "Acepe",
	url: "https://acepe.dev",
	description,
	publisher: {
		"@type": "Organization",
		name: "Acepe",
		url: "https://acepe.dev",
	},
	inLanguage: "en-US",
};

const softwareSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "Acepe",
	description,
	applicationCategory: "DeveloperApplication",
	applicationSubCategory: "AI Coding Agent Client",
	operatingSystem: "macOS, Windows, Linux",
	url: "https://acepe.dev",
	downloadUrl: "https://acepe.dev/download",
	image: "https://acepe.dev/og-image.png",
	screenshot: "https://acepe.dev/og-image.png",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
		availability: "https://schema.org/InStock",
		url: "https://acepe.dev/download",
	},
	featureList: [
		"Run Claude Code, Codex, Cursor Agent, and OpenCode side by side",
		"Parallel agent sessions with attention queue triage",
		"Readable plan mode with full markdown rendering",
		"Unified session history across projects",
		"File-level checkpoints with time-travel debugging",
		"Built-in Git panel and diff viewer",
		"Keyboard-first design with focus mode",
	],
	author: {
		"@type": "Organization",
		name: "Acepe",
		url: "https://acepe.dev",
	},
};

const jsonLdOrg = JSON.stringify(organizationSchema);
const jsonLdWebsite = JSON.stringify(websiteSchema);
const jsonLdSoftware = JSON.stringify(softwareSchema);
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${jsonLdOrg}</script>`}
	{@html `<script type="application/ld+json">${jsonLdWebsite}</script>`}
	{@html `<script type="application/ld+json">${jsonLdSoftware}</script>`}
</svelte:head>
