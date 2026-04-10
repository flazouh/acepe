<script lang="ts">
import { getLocale } from "$lib/paraglide/runtime";

const locale = getLocale();

const description =
	locale === "en"
		? "A native desktop client for Claude Code, Codex, Cursor Agent, and any ACP-compatible AI agent. Same powerful agents, better interface."
		: "Un cliente de escritorio nativo para Claude Code, Codex, Cursor Agent y cualquier agente de IA compatible con ACP. Los mismos agentes potentes, mejor interfaz.";

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "Acepe",
	url: "https://acepe.dev",
	logo: "https://acepe.dev/favicon-512x512.png",
	description,
};

const softwareSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "Acepe",
	description,
	applicationCategory: "DeveloperApplication",
	operatingSystem: "macOS, Windows, Linux",
	url: "https://acepe.dev",
	image: "https://acepe.dev/og-image.png",
	screenshot: "https://acepe.dev/og-image.png",
	softwareVersion: "1.0",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	featureList: [
		"Readable plan mode with markdown rendering",
		"Unified session history across projects",
		"Multi-agent support (Claude Code, Codex, OpenCode)",
		"Parallel agent sessions",
		"Keyboard-first design",
		"Focus mode for deep work",
	],
	aggregateRating: {
		"@type": "AggregateRating",
		ratingValue: "5",
		ratingCount: "1",
	},
};

const jsonLdOrg = JSON.stringify(organizationSchema);
const jsonLdSoftware = JSON.stringify(softwareSchema);
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${jsonLdOrg}</script>`}
	{@html `<script type="application/ld+json">${jsonLdSoftware}</script>`}
</svelte:head>
