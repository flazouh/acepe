<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { enhance } from '$app/forms';
	import { IconArrowRight, IconCheck } from '@tabler/icons-svelte';

	let { ctaVariant = 'getStarted' }: { ctaVariant?: 'getStarted' | 'waitlist' } = $props();

	let email = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state(false);
	let expanded = $state(false);

	let inputRef = $state<HTMLInputElement | null>(null);

	function handleExpand() {
		expanded = true;
		// Focus input after DOM updates
		setTimeout(() => inputRef?.focus(), 50);
	}

	function handleSubmit() {
		return async ({ result, update }: any) => {
			loading = true;
			await update();
			loading = false;

			if (result.type === 'success') {
				success = true;
				error = null;
				email = '';
			} else if (result.type === 'failure') {
				error = result.data?.error || 'Something went wrong';
				success = false;
			}
		};
	}
</script>

<div class="inline-flex flex-col items-center">
	{#if success}
		<div
			class="inline-flex h-11 items-center gap-2 rounded-full bg-card/70 px-5 font-medium text-foreground"
		>
			<IconCheck size={18} class="text-green-400" />
			<span>{m.waitlist_success_title()}</span>
		</div>
	{:else if expanded}
		<form
			method="POST"
			action="?/join"
			use:enhance={handleSubmit}
			class="flex flex-col gap-2 sm:flex-row"
		>
			<input
				bind:this={inputRef}
				type="email"
				name="email"
				bind:value={email}
				placeholder={m.waitlist_email_placeholder()}
				required
				disabled={loading}
				class="h-11 w-full rounded-full border border-border bg-card/70 px-4 text-foreground transition-all duration-200 placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:opacity-50 sm:w-64"
			/>
			<button
				type="submit"
				disabled={loading}
				class="theme-invert-btn group inline-flex h-11 cursor-pointer items-center justify-center rounded-full py-1.5 pr-1.5 pl-5 font-medium transition-all duration-200 disabled:opacity-50"
			>
				<span>{loading ? m.loading() : m.waitlist_submit()}</span>
				<span
					class="theme-invert-btn-icon ml-2 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200"
				>
					<IconArrowRight size={18} class="theme-invert-btn-icon-svg transition-all duration-200" />
				</span>
			</button>
		</form>
		{#if error}
			<p class="mt-2 text-sm text-red-400">{error}</p>
		{/if}
	{:else}
		<button
			onclick={handleExpand}
			class="theme-invert-btn group inline-flex h-11 cursor-pointer items-center justify-center rounded-full py-1.5 pr-1.5 pl-5 font-medium transition-all duration-200"
		>
			<span>{ctaVariant === 'waitlist' ? m.waitlist_modal_title() : m.landing_hero_cta()}</span>
			<span
				class="theme-invert-btn-icon ml-2 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200"
			>
				<IconArrowRight size={18} class="theme-invert-btn-icon-svg transition-all duration-200" />
			</span>
		</button>
	{/if}
</div>
