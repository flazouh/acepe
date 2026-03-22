<script lang="ts">
	import type { AppSessionItem } from './types.js';

	interface Props {
		session: AppSessionItem;
	}

	let { session }: Props = $props();
</script>

<!--
	Matches the FeedItem (attention-queue-item.svelte) + ActivityEntry visual:
	  px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors
	  icon: w-3 h-3 (12px) m-0.5  ← matches SessionItem's agentBadge
	  title: text-xs font-medium truncate
-->
<button
	type="button"
	class="flex flex-col justify-center w-full text-left gap-1 px-2 py-1.5 rounded-md transition-colors hover:bg-accent/50 {session.isActive
		? 'bg-accent/20'
		: ''}"
>
	<div class="flex items-center gap-1.5">
		{#if session.agentIconSrc}
			<img
				src={session.agentIconSrc}
				alt=""
				class="w-3 h-3 shrink-0 m-0.5"
				role="presentation"
				width="12"
				height="12"
			/>
		{/if}

		<div class="flex-1 min-w-0">
			<div class="text-xs font-medium truncate">{session.title}</div>
		</div>

		{#if session.status === 'running'}
			<span class="relative flex h-1.5 w-1.5 shrink-0">
				<span
					class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"
				></span>
				<span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
			</span>
		{:else if session.status === 'done'}
			<span class="h-1.5 w-1.5 rounded-full shrink-0 bg-green-500"></span>
		{:else if session.status === 'error'}
			<span class="h-1.5 w-1.5 rounded-full shrink-0 bg-destructive"></span>
		{:else if session.status === 'unseen'}
			<span class="h-1.5 w-1.5 rounded-full shrink-0 bg-yellow-500"></span>
		{/if}
	</div>
</button>
