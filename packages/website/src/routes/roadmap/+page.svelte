<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import Header from '$lib/components/header.svelte';
	import PageHero from '$lib/components/page-hero.svelte';
	import RoadmapBoard from '$lib/components/roadmap/roadmap-board.svelte';
	import { RoadmapState } from '$lib/components/roadmap/roadmap-state.svelte.js';

	let { data } = $props();

	const state = $derived(
		new RoadmapState({
			columns: data.columns,
			userId: data.userId
		})
	);
</script>

<div class="min-h-screen">
	<Header
		showLogin={data.featureFlags.loginEnabled}
		showDownload={data.featureFlags.downloadEnabled}
	/>

	<main class="pt-20">
		<PageHero title={m.roadmap_page_title()} subtitle={m.roadmap_page_subtitle()} />

		<div class="mx-auto max-w-6xl px-6 pb-24 pt-8">
			<RoadmapBoard {state} />
		</div>
	</main>
</div>
