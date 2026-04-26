<script lang="ts">
import { Tree } from "phosphor-svelte";
import { Tooltip } from "bits-ui";
import Folder from "@lucide/svelte/icons/folder-open";
import { revealInFinder } from "$lib/utils/tauri-client/opener.js";
import { toast } from "svelte-sonner";

interface Props {
	/** The path to open in Finder. When null, the button is hidden. */
	worktreePath: string | null;
	/** Visible label (usually the worktree directory name). */
	label: string | null;
	/**
	 * Whether this is a worktree (green tree icon) or project root (folder icon).
	 */
	mode?: "worktree" | "project-root";
}

let { worktreePath, label, mode = "worktree" }: Props = $props();

function handleClick(): void {
	if (!worktreePath) return;
	void revealInFinder(worktreePath).match(
		() => {},
		(error) => {
			toast.error(`Could not reveal in Finder: ${error.message}`);
		}
	);
}
</script>

{#if worktreePath && label}
	<Tooltip.Provider delayDuration={400}>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						type="button"
						onclick={handleClick}
						class="h-7 inline-flex items-center gap-1.5 px-3 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
						aria-label="Reveal worktree in Finder"
					>
						{#if mode === "worktree"}
							<Tree size={12} weight="fill" class="shrink-0 text-success" />
						{:else}
							<Folder class="size-3 shrink-0 text-muted-foreground" />
						{/if}
						<span class="truncate max-w-[140px] text-[0.6875rem] font-medium text-foreground">
							{label}
						</span>
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					class="z-[var(--overlay-z)] rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md max-w-[320px] truncate"
					sideOffset={4}
					side="top"
				>
					Reveal in Finder · {worktreePath}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	</Tooltip.Provider>
{/if}
