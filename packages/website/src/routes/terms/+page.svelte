<script lang="ts">
import Header from "$lib/components/header.svelte";
import Seo from "$lib/components/seo/seo.svelte";

let { data } = $props();

const sections = [
	{
		num: "01",
		title: "License",
		items: [
			{
				label: "MIT",
				body: "Acepe's source code is available on GitHub under the MIT License.",
			},
			{
				label: "Permitted use",
				body: "You may use, copy, modify, distribute, sublicense, and sell copies of the software.",
			},
			{
				label: "Notice",
				body: "Copies or substantial portions of the software must include the copyright notice and MIT license text.",
			},
		],
	},
	{
		num: "02",
		title: "Your Responsibilities",
		items: [
			{
				label: "Prompts & output",
				body: "You are responsible for the prompts and instructions you send to AI agents through the application, and for any code or content generated during your sessions.",
			},
			{
				label: "Agent providers",
				body: "You are responsible for complying with the terms of service of any AI provider you connect (Anthropic, OpenAI, etc.).",
			},
		],
	},
	{
		num: "03",
		title: "No Warranty",
		items: [
			{
				label: "As-is",
				body: 'The software is provided "as is", without warranties of any kind, express or implied — including warranties of fitness for a particular purpose, merchantability, title, or non-infringement.',
			},
		],
	},
	{
		num: "04",
		title: "Limitation of Liability",
		items: [
			{
				label: "Damages",
				body: "We will not be liable for any damages arising from your use of the software, including indirect, special, incidental, or consequential damages — even if we were informed of the possibility in advance. This includes data loss resulting from agent actions or the checkpoint/revert system.",
			},
		],
	},
	{
		num: "05",
		title: "The Website",
		items: [
			{
				label: "Beta period",
				body: "The acepe.dev website and associated services are operated as-is during the beta period. We reserve the right to modify or discontinue any service at any time without notice.",
			},
			{
				label: "Changes",
				body: "We may update these terms occasionally. Continued use of the software or website after changes constitutes acceptance of the updated terms.",
			},
		],
	},
	{
		num: "06",
		title: "Contact",
		items: [
			{
				label: "GitHub",
				body: "Questions or concerns? Open an issue at github.com/flazouh/acepe.",
			},
		],
	},
];
</script>

<Seo
	title="Terms of Use"
	description="Acepe terms of use under the MIT open-source license."
/>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="mx-auto max-w-3xl px-4 pt-32 pb-24 md:px-6">
		<!-- Page header -->
		<div class="mb-8">
			<div class="mb-4 flex items-center gap-2">
				<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">//</span>
				<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">legal</span>
			</div>
			<h1 class="mb-2 text-2xl font-semibold tracking-[-0.03em] md:text-[36px]">Terms of Use</h1>
			<p class="font-mono text-xs text-muted-foreground/50">last updated — july 2026</p>
		</div>

		<!-- Sections -->
		<div class="flex flex-col gap-2">
			{#each sections as section}
				<div class="overflow-hidden rounded-xl border border-border/50 bg-card/20 policy-card">
					<!-- Panel header -->
					<div class="flex h-9 items-center gap-3 border-b border-border/50 px-3">
						<span class="font-mono text-[10px] text-muted-foreground/40">{section.num}</span>
						<span class="font-mono text-xs font-semibold text-foreground">{section.title}</span>
					</div>

					<!-- Items -->
					<div class="flex flex-col">
						{#each section.items as item, i}
							<div class="flex gap-4 px-4 py-3.5 {i > 0 ? 'border-t border-border/30' : ''}">
								<span class="w-28 shrink-0 font-mono text-[11px] text-muted-foreground/50 pt-0.5">{item.label}</span>
								<p class="text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</main>
</div>

<style>
	.policy-card {
		backdrop-filter: blur(12px);
	}
</style>
