<script lang="ts">
	import Header from '$lib/components/header.svelte';

	let { data } = $props();

	const sections = [
		{
			num: '01',
			title: 'What We Collect',
			items: [
				{
					label: 'Waitlist',
					body: 'If you join the waitlist, we store your email address and the timestamp of your signup. We use this solely to notify you when Acepe is available. We do not sell or share this data with third parties.',
				},
				{
					label: 'Analytics',
					body: 'We do not run any third-party analytics or tracking scripts on this site. No cookies are set for tracking purposes.',
				},
				{
					label: 'Error reporting',
					body: 'The desktop app does not transmit any telemetry or crash reports by default.',
				},
			],
		},
		{
			num: '02',
			title: 'Data Storage',
			items: [
				{
					label: 'Retention',
					body: 'Waitlist emails are stored in a database hosted on infrastructure we control. We retain this data only as long as it is needed to contact you about the product.',
				},
			],
		},
		{
			num: '03',
			title: 'Your Rights',
			items: [
				{
					label: 'Deletion',
					body: 'You can request deletion of your waitlist entry at any time by emailing us. We will remove your data within 7 days.',
				},
			],
		},
		{
			num: '04',
			title: 'Third-Party Services',
			items: [
				{
					label: 'Hosting',
					body: 'The website is hosted on Vercel. Their privacy policy applies to infrastructure-level data (IP addresses, request logs) in the same way it applies to any site on their platform.',
				},
				{
					label: 'Agent connections',
					body: 'Connections made through the desktop app go directly between your machine and the agent provider (Anthropic, OpenAI, etc.). Acepe does not proxy or log these requests.',
				},
			],
		},
		{
			num: '05',
			title: 'Contact',
			items: [
				{
					label: 'GitHub',
					body: 'Questions? Open an issue at github.com/flazouh/acepe or email us at the address in the repository.',
				},
			],
		},
	];
</script>

<svelte:head>
	<title>Privacy Policy - Acepe</title>
	<meta name="description" content="Acepe privacy policy — what data we collect and how we use it." />
</svelte:head>

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
			<h1 class="mb-2 text-2xl font-semibold tracking-[-0.03em] md:text-[36px]">Privacy Policy</h1>
			<p class="font-mono text-xs text-muted-foreground/50">last updated — march 2026</p>
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
