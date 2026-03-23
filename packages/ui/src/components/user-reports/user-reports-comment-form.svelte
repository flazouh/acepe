<script lang="ts">
	interface Props {
		placeholder?: string;
		submitLabel?: string;
		autofocus?: boolean;
		onSubmit: (body: string) => Promise<void>;
		onCancel?: () => void;
	}

	let {
		placeholder = 'Write a comment...',
		submitLabel = 'Comment',
		autofocus = false,
		onSubmit,
		onCancel
	}: Props = $props();

	let body = $state('');
	let submitting = $state(false);

	const canSubmit = $derived(body.trim().length > 0 && !submitting);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		await onSubmit(body.trim())
			.then(() => {
				body = '';
			})
			.finally(() => {
				submitting = false;
			});
	}
</script>

<div class="flex flex-col gap-2">
	<textarea
		bind:value={body}
		{placeholder}
		rows={3}
		class="w-full resize-y rounded-md border border-border/40 bg-input/30 px-2.5 py-2 text-[12px] text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:border-ring focus:ring-ring/50 focus:ring-[3px] outline-none transition-shadow"
		onkeydown={(e) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
		}}
	></textarea>
	<div class="flex items-center justify-end gap-2">
		{#if onCancel}
			<button
				type="button"
				class="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
				onclick={onCancel}
			>
				Cancel
			</button>
		{/if}
		<button
			type="button"
			class="px-3 py-1 text-[11px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-40 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
			disabled={!canSubmit}
			onclick={handleSubmit}
		>
			{submitting ? 'Posting...' : submitLabel}
		</button>
	</div>
</div>
