<script lang="ts">
	import { capture, AnalyticsEvent } from '$lib/analytics.js';
	import * as m from '$lib/paraglide/messages.js';
	import mainScreenshot from '$lib/assets/screenshots/main.png';

	const { data } = $props();

	let downloading = $state(false);

	function handleDownload() {
		capture(AnalyticsEvent.Downloaded, {
			arch: 'aarch64',
			version: data.version ?? undefined
		});
		downloading = true;
		setTimeout(() => (downloading = false), 4000);
	}
</script>

<div class="flex min-h-screen flex-col bg-background lg:flex-row">
	<!-- Left Side -->
	<div class="flex w-full flex-col justify-center px-6 py-8 lg:w-[45%] lg:px-24 lg:py-0">
		<!-- Logo -->
		<a href="/" class="mb-8 flex items-center gap-4 transition-opacity hover:opacity-80 lg:mb-16">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				viewBox="0 0 32 32"
				fill="none"
				class="h-10 w-10"
			>
				<rect
					x="5"
					y="5"
					width="6"
					height="22"
					rx="2"
					fill="currentColor"
					class="text-primary/30"
				/>
				<rect
					x="13"
					y="5"
					width="6"
					height="22"
					rx="2"
					fill="currentColor"
					class="text-primary/60"
				/>
				<rect x="21" y="5" width="6" height="22" rx="2" fill="currentColor" class="text-primary" />
			</svg>
			<span class="text-2xl font-semibold tracking-wider text-foreground">{m.app_name()}</span>
		</a>

		<!-- Headline -->
		<h1 class="mb-6 text-4xl leading-[1.2] font-normal text-foreground sm:text-5xl lg:text-[60px]">
			Every agent.<br />One home.
		</h1>

		<!-- Subtitle -->
		<p class="mb-10 max-w-md text-base text-muted-foreground sm:text-lg lg:text-xl">
			Download Acepe for Mac.{#if data.version}<span class="ml-2 text-sm">v{data.version}</span
				>{/if}
		</p>

		<!-- Download Button -->
		<div class="mb-8 flex gap-4">
			<a
				href="/api/download?arch=aarch64"
				onclick={handleDownload}
				class="theme-invert-btn flex items-center gap-3 rounded-lg px-6 py-3 font-medium transition-colors"
			>
				{#if downloading}
					<svg class="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
						<path
							d="M12 2a10 10 0 0 1 10 10"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
						/>
					</svg>
					Downloading...
				{:else}
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
						<path
							d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"
						/>
					</svg>
					Download for Mac
				{/if}
			</a>
		</div>

		<!-- Requirement -->
		<p class="text-sm text-muted-foreground">Requires macOS 12+ on Apple Silicon.</p>
	</div>

	<!-- Right Side - Screenshot -->
	<div class="flex w-full items-center justify-center p-6 lg:w-[55%] lg:p-8">
		<img
			src={mainScreenshot}
			alt="Acepe app interface"
			class="max-h-[60vh] w-full rounded-xl object-contain shadow-2xl lg:max-h-[90vh]"
		/>
	</div>
</div>
