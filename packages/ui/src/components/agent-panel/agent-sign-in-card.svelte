<script lang="ts">
	import { Button } from "../button/index.js";
	import { LoadingIcon, RoundedIcon } from "../icons/index.js";

	interface Props {
		title: string;
		message: string;
		dismissLabel?: string;
		signInLabel?: string;
		isSigningIn?: boolean;
		signInError?: string | null;
		onSignIn?: (() => void) | undefined;
		onCancelSignIn?: (() => void) | undefined;
		onDismiss?: (() => void) | undefined;
	}

	let {
		title,
		message,
		dismissLabel = "Dismiss",
		signInLabel = "Sign in",
		isSigningIn = false,
		signInError = null,
		onSignIn,
		onCancelSignIn,
		onDismiss,
	}: Props = $props();
</script>

<div
	class="w-full rounded-lg border border-border bg-input/30"
	data-testid="agent-sign-in-card"
	aria-busy={isSigningIn}
>
	<div class="flex w-full min-w-0 items-start gap-2 px-3 py-2">
		<RoundedIcon name="lock" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" data-testid="agent-sign-in-icon" />
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<span class="text-[0.6875rem] font-medium text-foreground">{title}</span>
			<span class="text-[0.6875rem] leading-relaxed text-muted-foreground">{message}</span>
			{#if signInError}
				<span role="status" aria-live="polite" class="text-[0.625rem] text-destructive">
					{signInError}
				</span>
			{/if}
		</div>

		{#if onSignIn || onDismiss}
			<div
				class="ml-auto flex shrink-0 items-center gap-1"
				role="none"
				onclick={(event: MouseEvent) => event.stopPropagation()}
			>
				{#if onSignIn}
					<Button
						variant="default"
						size="xs"
						onclick={onSignIn}
						disabled={isSigningIn}
						aria-label={isSigningIn ? "Signing in…" : signInLabel}
					>
						{#if isSigningIn}
							<LoadingIcon size={11} class="animate-spin" />
							Signing in…
						{:else}
							{signInLabel}
						{/if}
					</Button>
				{/if}
				{#if isSigningIn && onCancelSignIn}
					<Button variant="secondary" size="xs" onclick={onCancelSignIn}>Cancel</Button>
				{:else if onDismiss}
					<Button variant="secondary" size="xs" onclick={onDismiss}>{dismissLabel}</Button>
				{/if}
			</div>
		{/if}
	</div>
</div>
