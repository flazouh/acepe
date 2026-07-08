<script lang="ts">
	import { Button } from "../button/index.js";
	import { LoadingIcon, RoundedIcon, type RoundedIconName } from "../icons/index.js";

	interface Props {
		title: string;
		message?: string | null;
		actionLabel: string;
		actionIconName?: RoundedIconName | null;
		workingLabel?: string;
		isWorking?: boolean;
		dismissLabel?: string;
		onAction: () => void;
		onDismiss?: (() => void) | undefined;
	}

	let {
		title,
		message = null,
		actionLabel,
		actionIconName = null,
		workingLabel = actionLabel,
		isWorking = false,
		dismissLabel = "Dismiss",
		onAction,
		onDismiss,
	}: Props = $props();

	const hasMessage = $derived(message !== null && message.trim().length > 0);
</script>

<div class="w-full rounded-lg border border-border bg-input/30" data-testid="agent-panel-recovery-card">
	<div class="flex w-full min-w-0 gap-2 px-3 py-2 {hasMessage ? 'items-start' : 'items-center'}">
		<RoundedIcon
			name="archive"
			class="{hasMessage ? 'mt-0.5' : ''} size-[14px] shrink-0 text-muted-foreground"
		/>
		<div class="flex min-w-0 flex-1 flex-col {hasMessage ? 'gap-1' : 'justify-center'}">
			<span class="font-medium text-foreground">{title}</span>
			{#if message}
				<span class="text-[0.6875rem] leading-relaxed text-muted-foreground">{message}</span>
			{/if}
		</div>

		<div
			class="ml-auto flex shrink-0 items-center gap-1"
			role="none"
			onclick={(event: MouseEvent) => event.stopPropagation()}
		>
			{#if onDismiss}
				<Button variant="secondary" size="xs" onclick={onDismiss}>
					{dismissLabel}
				</Button>
			{/if}
			<Button
				variant="default"
				size="xs"
				disabled={isWorking}
				aria-busy={isWorking ? "true" : undefined}
				onclick={onAction}
			>
				{#if isWorking}
					<LoadingIcon class="shrink-0" size={10} />
					{workingLabel}
				{:else}
					{#if actionIconName}
						<RoundedIcon name={actionIconName} class="size-3 shrink-0" />
					{/if}
					{actionLabel}
				{/if}
			</Button>
		</div>
	</div>
</div>
