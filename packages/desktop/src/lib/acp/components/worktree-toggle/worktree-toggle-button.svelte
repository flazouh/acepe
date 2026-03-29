<!--
  WorktreeToggleButton - Toggle for worktree isolation.

  Toggles whether the next message will use a worktree.
  Shows the active worktree name when one exists.
-->
<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { tick } from "svelte";
import DotsThreeVertical from "phosphor-svelte/lib/DotsThreeVertical";
import Gear from "phosphor-svelte/lib/Gear";
import NotePencil from "phosphor-svelte/lib/NotePencil";
import Tree from "phosphor-svelte/lib/Tree";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	disabled: boolean;
	loading: boolean;
	tooltipText: string;
	worktreeName: string | null;
	pending: boolean;
	deleted: boolean;
	autoWorktree?: boolean;
	onCreate: () => void;
	onAutoWorktreeChange?: (enabled: boolean) => void;
	onRename?: (name: string) => void | Promise<void>;
	onOpenSettings?: () => void;
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
	autoWorktree = false,
	onCreate,
	onAutoWorktreeChange,
	onRename,
	onOpenSettings,
	variant = "default",
}: Props = $props();

const hasWorktree = $derived(worktreeName !== null);
const active = $derived(hasWorktree || pending);
const buttonLabel = $derived.by(() => {
	if (hasWorktree) return worktreeName;
	if (pending) return m.worktree_toggle_pending_label();
	return m.worktree_toggle_label();
});
const canRename = $derived(hasWorktree && loading === false && deleted === false && Boolean(onRename));
const showMenu = $derived(canRename || Boolean(onOpenSettings));

let isRenaming = $state(false);
let renameDraft = $state("");
let renameInput: HTMLInputElement | null = $state(null);

function startRenameEditing(): void {
	if (!canRename || worktreeName === null) return;
	isRenaming = true;
	renameDraft = worktreeName;
	void tick().then(() => {
		if (renameInput) {
			renameInput.focus();
			renameInput.select();
		}
	});
}

function openRenameEditor(event: MouseEvent): void {
	event.stopPropagation();
	startRenameEditing();
}

function closeRenameEditor(): void {
	isRenaming = false;
	renameDraft = "";
}

function submitRename(): void {
	if (!onRename || worktreeName === null) {
		closeRenameEditor();
		return;
	}

	const trimmedName = renameDraft.trim();
	if (trimmedName === "" || trimmedName === worktreeName) {
		closeRenameEditor();
		return;
	}

	closeRenameEditor();
	void onRename(trimmedName);
}

function handleRenameKeydown(event: KeyboardEvent): void {
	if (event.key === "Enter") {
		event.preventDefault();
		submitRename();
		return;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		closeRenameEditor();
	}
}
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props: triggerProps })}
			<div class="inline-flex h-full min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
				{#if isRenaming}
					<div class="inline-flex h-full min-w-0 items-center gap-1.5 px-2">
						<Tree
							class="size-3 shrink-0 {deleted
								? 'text-destructive'
								: active
									? 'text-success'
									: 'text-muted-foreground'}"
							weight={active ? "fill" : "regular"}
						/>
						<Input
							bind:ref={renameInput}
							bind:value={renameDraft}
							type="text"
							class="h-6 w-36 border-0 bg-transparent px-0 font-mono text-xs text-foreground shadow-none focus-visible:ring-0"
							onkeydown={handleRenameKeydown}
							onblur={submitRename}
							aria-label="Rename worktree"
						/>
					</div>
				{:else}
					<button
						type="button"
						{...triggerProps}
						class="inline-flex h-full min-w-0 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 {variant ===
							'minimal' && !active
							? 'rounded-md hover:rounded-full'
							: ''}"
						disabled={disabled || loading || autoWorktree}
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
					{#if showMenu}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props: menuProps })}
									<EmbeddedIconButton
										{...menuProps}
										ariaLabel="Worktree menu"
										title="Worktree menu"
										class="shrink-0 {variant === 'minimal' ? '!w-5 rounded-md hover:rounded-full' : ''}"
									>
										<DotsThreeVertical class="size-3" weight="bold" />
									</EmbeddedIconButton>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="min-w-[200px] p-0" sideOffset={4}>
								<DropdownMenu.Item
									class="cursor-pointer rounded-none px-2 py-1.5 text-[11px]"
									onclick={openRenameEditor}
									disabled={!canRename}
								>
									<NotePencil class="size-3.5 shrink-0" weight="bold" />
									<span>Rename</span>
								</DropdownMenu.Item>
								<DropdownMenu.Item
									class="cursor-pointer rounded-none border-t border-border/20 px-2 py-1.5 text-[11px]"
									onclick={() => {
										if (onOpenSettings) {
											onOpenSettings();
										}
									}}
									disabled={!onOpenSettings}
								>
									<Gear class="size-3.5 shrink-0" weight="fill" />
									<span>{m.setup_scripts_dialog_title()}</span>
								</DropdownMenu.Item>
								<DropdownMenu.Item
									class="rounded-none border-t border-border/20 px-2 py-1.5 text-[11px]"
									onclick={(event) => {
										event.preventDefault();
										onAutoWorktreeChange?.(!autoWorktree);
									}}
									disabled={loading}
								>
									<div class="flex w-full items-center justify-between gap-3">
										<div class="flex min-w-0 items-center gap-2">
											<Tree
												class="size-3.5 shrink-0"
												style={autoWorktree ? 'color: var(--success);' : undefined}
												weight={autoWorktree ? 'fill' : 'regular'}
											/>
											<span class="truncate">Auto worktree</span>
										</div>
									<Switch
										checked={autoWorktree}
												disabled={loading}
										onCheckedChange={(checked) => {
											onAutoWorktreeChange?.(checked);
										}}
										/>
									</div>
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				{/if}
			</div>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>
		{tooltipText}
	</Tooltip.Content>
</Tooltip.Root>
