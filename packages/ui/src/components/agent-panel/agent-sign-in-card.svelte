<script lang="ts">
	import { Button } from "../button/index.js";

	interface Props {
		title: string;
		message: string;
		command?: string | null;
		commandHint?: string;
		dismissLabel?: string;
		onDismiss?: (() => void) | undefined;
	}

	let {
		title,
		message,
		command = null,
		commandHint = "Run this in your terminal, then retry:",
		dismissLabel = "Dismiss",
		onDismiss,
	}: Props = $props();

	const hasCommand = $derived(command !== null && command.trim().length > 0);
</script>

{#snippet signInIcon()}
	<span class="sign-in-icon mt-0.5 shrink-0 text-muted-foreground" data-testid="agent-sign-in-css-icon" aria-hidden="true">
		<span class="sign-in-door"></span>
		<span class="sign-in-arrow-shaft"></span>
		<span class="sign-in-arrow-head"></span>
	</span>
{/snippet}

<div class="w-full rounded-lg border border-border bg-input/30">
	<div class="flex w-full min-w-0 items-start gap-2 px-3 py-2">
		{@render signInIcon()}
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="text-[0.6875rem] font-medium text-foreground">{title}</span>
			<span class="text-[0.6875rem] leading-relaxed text-muted-foreground">{message}</span>
			{#if hasCommand}
				<div class="mt-0.5 flex flex-col gap-1">
					<span class="text-[0.625rem] text-muted-foreground/80">{commandHint}</span>
					<code
						class="w-fit max-w-full overflow-x-auto rounded border border-border bg-background px-2 py-1 font-mono text-[0.6875rem] text-foreground"
						>{command}</code
					>
				</div>
			{/if}
		</div>

		{#if onDismiss}
			<div
				class="ml-auto flex shrink-0 items-center gap-1"
				role="none"
				onclick={(event: MouseEvent) => event.stopPropagation()}
			>
				<Button variant="secondary" size="xs" onclick={onDismiss}>
					{dismissLabel}
				</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	.sign-in-icon {
		position: relative;
		display: inline-block;
		width: 14px;
		height: 14px;
	}

	.sign-in-door {
		position: absolute;
		right: 1px;
		top: 1.5px;
		width: 6px;
		height: 11px;
		border: 1.4px solid currentColor;
		border-left: 0;
		border-radius: 0 2px 2px 0;
	}

	.sign-in-arrow-shaft {
		position: absolute;
		left: 1px;
		top: 6.3px;
		width: 8px;
		height: 1.4px;
		border-radius: 999px;
		background: currentColor;
	}

	.sign-in-arrow-head {
		position: absolute;
		left: 5.8px;
		top: 4px;
		width: 4.5px;
		height: 4.5px;
		border-top: 1.4px solid currentColor;
		border-right: 1.4px solid currentColor;
		border-radius: 0 1px 0 0;
		transform: rotate(45deg);
	}
</style>
