<script lang="ts">
	import { createMutation, useQueryClient } from '@tanstack/svelte-query';
	import { Bug, Lightbulb, Question, ChatCircle } from 'phosphor-svelte';
	import { cn } from '../../lib/utils.js';
	import type { ApiClient, ReportOutput } from '@acepe/api';
	import type { ReportCategory } from './types.js';

	interface Props {
		apiClient: ApiClient;
		onCreated: (report: ReportOutput) => void;
		onCancel: () => void;
	}

	let { apiClient, onCreated, onCancel }: Props = $props();

	const queryClient = useQueryClient();

	let title = $state('');
	let body = $state('');
	let category = $state<ReportCategory>('bug');
	let error = $state<string | null>(null);

	const categories = [
		{ value: 'bug' as const, label: 'Bug', icon: Bug },
		{ value: 'feature_request' as const, label: 'Feature', icon: Lightbulb },
		{ value: 'question' as const, label: 'Question', icon: Question },
		{ value: 'discussion' as const, label: 'Discussion', icon: ChatCircle }
	];

	const mutation = createMutation({
		mutationFn: () => apiClient.reports.create({ title, body, category }),
		onSuccess: (report) => {
			queryClient.invalidateQueries({ queryKey: ['reports'] });
			onCreated(report);
		},
		onError: (e) => {
			error = e instanceof Error ? e.message : 'Failed to create report';
		}
	});

	const canSubmit = $derived(title.length >= 3 && body.length >= 10 && !$mutation.isPending);

	function handleSubmit() {
		if (!canSubmit) return;
		error = null;
		$mutation.mutate();
	}
</script>

<div class="flex flex-col max-w-2xl mx-auto w-full px-5 py-6 gap-5 min-h-full justify-center">
	<div class="flex flex-col gap-1.5">
		<label for="report-title" class="text-[10px] font-semibold font-mono text-muted-foreground/60 uppercase tracking-wider"
			>Title</label
		>
		<input
			id="report-title"
			bind:value={title}
			placeholder="Short, descriptive title"
			class="h-9 px-3 text-sm rounded-md border border-border/50 bg-input/30 text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:ring-ring/50 focus:ring-[3px] outline-none transition-shadow"
		/>
	</div>

	<div class="flex flex-col gap-1.5">
		<span class="text-[10px] font-semibold font-mono text-muted-foreground/60 uppercase tracking-wider">Category</span>
		<div class="flex gap-1.5">
			{#each categories as cat}
				<button
					type="button"
					class={cn(
						'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium font-mono transition-colors cursor-pointer border',
						category === cat.value
							? 'bg-primary/10 text-primary border-primary/25'
							: 'bg-accent/30 text-muted-foreground border-border/30 hover:bg-accent/50'
					)}
					onclick={() => (category = cat.value)}
				>
					<cat.icon size={12} weight="fill" />
					{cat.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-col gap-1.5 flex-1">
		<label for="report-body" class="text-[10px] font-semibold font-mono text-muted-foreground/60 uppercase tracking-wider"
			>Description</label
		>
		<textarea
			id="report-body"
			bind:value={body}
			placeholder="Describe the issue, feature, or question in detail..."
			rows={12}
			class="w-full resize-y rounded-lg border border-border/50 bg-input/30 px-3 py-2.5 text-sm text-foreground leading-relaxed placeholder:text-muted-foreground/40 focus:border-ring focus:ring-ring/50 focus:ring-[3px] outline-none transition-shadow"
			onkeydown={(e) => {
				if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
			}}
		></textarea>
		<span class="text-[10px] text-muted-foreground/40">Cmd+Enter to submit.</span>
	</div>

	{#if error}
		<div class="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-1.5">
			{error}
		</div>
	{/if}

	<div class="flex items-center justify-end gap-2">
		<button
			type="button"
			class="px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			onclick={onCancel}
		>
			Cancel
		</button>
		<button
			type="button"
			class="px-4 py-1.5 text-[11px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-40 rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
			disabled={!canSubmit}
			onclick={handleSubmit}
		>
			{$mutation.isPending ? 'Posting...' : 'Post Report'}
		</button>
	</div>
</div>
