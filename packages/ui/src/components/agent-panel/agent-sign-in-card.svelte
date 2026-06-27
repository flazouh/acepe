<script lang="ts">
	import { SignIn } from "phosphor-svelte";
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

<div class="w-full rounded-lg border border-border bg-input/30">
	<div class="flex w-full min-w-0 items-start gap-2 px-3 py-2">
		<SignIn size={14} weight="bold" class="mt-0.5 shrink-0 text-muted-foreground" />
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
				<Button variant="headerAction" size="headerAction" onclick={onDismiss}>
					{dismissLabel}
				</Button>
			</div>
		{/if}
	</div>
</div>
