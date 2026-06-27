<script lang="ts">
import { Button, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Check, GitBranch } from "phosphor-svelte";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import {
	canCreateBranch as getCanCreateBranch,
	getFullBranchName,
	getNewBranchNameError,
	getNormalizedBranchName,
} from "./branch-picker-state.js";
import { BRANCH_PREFIXES, DEFAULT_BRANCH_PREFIX } from "./branch-prefix-options.js";

interface Props {
	open?: boolean;
	branches: readonly string[];
	switchingBranch: boolean;
	inputId: string;
	onCreate: (fullBranchName: string) => void;
	onOpenChange?: (open: boolean) => void;
}

let {
	open = $bindable(false),
	branches,
	switchingBranch,
	inputId,
	onCreate,
	onOpenChange,
}: Props = $props();

let newBranchName = $state("");
let selectedPrefix = $state(DEFAULT_BRANCH_PREFIX);
let prefixDropdownOpen = $state(false);
let newBranchInputRef = $state<HTMLInputElement | null>(null);

const normalizedNewBranchName = $derived(getNormalizedBranchName(newBranchName));
const fullBranchName = $derived(
	getFullBranchName({ prefix: selectedPrefix, branchName: newBranchName })
);
const newBranchNameError = $derived(
	getNewBranchNameError({
		normalizedBranchName: normalizedNewBranchName,
		fullBranchName,
		branches,
	})
);
const canCreateBranch = $derived(
	getCanCreateBranch({
		normalizedBranchName: normalizedNewBranchName,
		error: newBranchNameError,
		switchingBranch,
	})
);

const branchNameInputClass =
	"h-7 w-full rounded-lg border border-border/40 bg-muted/30 px-2 font-mono text-[0.6875rem] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40";

function handleOpenChange(nextOpen: boolean): void {
	open = nextOpen;
	onOpenChange?.(nextOpen);
}

function resetForm(): void {
	newBranchName = "";
	selectedPrefix = DEFAULT_BRANCH_PREFIX;
	prefixDropdownOpen = false;
}

function handleClose(): void {
	handleOpenChange(false);
}

function handleCreate(): void {
	if (!canCreateBranch) return;
	onCreate(fullBranchName);
}

$effect(() => {
	if (!open) return;
	resetForm();
	queueMicrotask(() => {
		newBranchInputRef?.focus();
	});
});
</script>

<DialogFrame
	{open}
	title="Create and checkout branch"
	closeLabel="Close create branch dialog"
	size="form"
	portalDisabled={true}
	onOpenChange={handleOpenChange}
>
	{#snippet topLeft()}
		<GitBranch size={14} weight="bold" class="shrink-0 text-primary" />
		<span class="truncate text-[11px] font-semibold text-foreground select-none">
			Create and checkout branch
		</span>
	{/snippet}

	<div class="grid gap-2.5 px-3 py-3">
		<div class="grid gap-1">
			<label
				for={inputId}
				class="text-[0.625rem] font-medium text-muted-foreground uppercase tracking-wider"
			>
				Branch name
			</label>
			<div class="grid grid-cols-[auto_1fr] gap-1.5 items-center">
				<Selector
					bind:open={prefixDropdownOpen}
					align="start"
					sideOffset={4}
					blockingOverlay
					variant="outline"
					triggerSize="minimal"
					triggerAriaLabel="Branch prefix"
				>
					{#snippet renderButton()}
						<selectedPrefix.icon
							class="h-3.5 w-3.5 shrink-0"
							weight="fill"
							style="color: {selectedPrefix.color}"
						/>
						<span class="font-mono">{selectedPrefix.value || "\u2014"}</span>
					{/snippet}

					{#each BRANCH_PREFIXES as prefix (prefix.label)}
						<DropdownMenu.Item
							onSelect={() => {
								selectedPrefix = prefix;
								prefixDropdownOpen = false;
								queueMicrotask(() => newBranchInputRef?.focus());
							}}
						>
							<prefix.icon
								class="h-3.5 w-3.5 shrink-0"
								weight="fill"
								style="color: {prefix.color}"
							/>
							<span class="flex-1">{prefix.label}</span>
							{#if selectedPrefix === prefix}
								<Check class="size-4 shrink-0 text-foreground" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</Selector>

				<input
					id={inputId}
					bind:this={newBranchInputRef}
					bind:value={newBranchName}
					placeholder="my-feature"
					class={branchNameInputClass}
					onkeydown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleCreate();
						}
					}}
				/>
			</div>
			{#if newBranchNameError}
				<p class="text-[0.625rem] text-destructive">{newBranchNameError}</p>
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<Button variant="header" size="header" disabled={switchingBranch} onclick={handleClose}>
			Cancel
		</Button>
		<Button
			variant="invert"
			size="header"
			disabled={!canCreateBranch}
			onclick={handleCreate}
		>
			{switchingBranch ? "Creating..." : "Create and checkout"}
		</Button>
	{/snippet}
</DialogFrame>
