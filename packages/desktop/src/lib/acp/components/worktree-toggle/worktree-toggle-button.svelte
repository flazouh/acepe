<!--
  WorktreeToggleButton - Toggle for worktree isolation.

  Toggles whether the next message will use a worktree.
  Shows the active worktree name when one exists.
-->
<script lang="ts">
import Tree from "phosphor-svelte/lib/Tree";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	disabled: boolean;
	loading: boolean;
	tooltipText: string;
	worktreeName: string | null;
	pending: boolean;
	deleted: boolean;
	onCreate: () => void;
	/** "minimal" = compact pill; "default" = standard footer look. */
	variant?: "default" | "minimal";
}

let {
	disabled,
	loading,
	tooltipText,
	worktreeName,
	pending,
	deleted,
	onCreate,
	variant = "default",
}: Props = $props();

const hasWorktree = $derived(worktreeName !== null);
const active = $derived(hasWorktree || pending);
const buttonLabel = $derived(hasWorktree ? worktreeName : m.worktree_toggle_label());
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props: triggerProps })}
			<button
				type="button"
				{...triggerProps}
				class="inline-flex h-full min-w-0 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed {variant ===
					'minimal' && !active
					? 'rounded-md hover:rounded-full'
					: ''}"
				disabled={disabled || loading}
				onclick={onCreate}
			>
				{#if loading}
					<Spinner class="size-3 shrink-0" />
				{:else}
					<Tree
						class="size-3 shrink-0 {deleted
							? 'text-destructive'
							: active
								? 'text-success'
								: 'text-muted-foreground'}"
						weight={active ? "fill" : "regular"}
					/>
				{/if}
				<span class="truncate {hasWorktree ? 'font-mono max-w-[9rem]' : ''}" title={buttonLabel}>
					{buttonLabel}
				</span>
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		{tooltipText}
	</Tooltip.Content>
</Tooltip.Root>
