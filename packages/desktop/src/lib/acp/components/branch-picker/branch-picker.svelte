<script lang="ts">
import { BranchPickerView } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import {
BookOpen,
Bug,
Check,
GitBranch,
Recycle,
Sparkle,
TestTube,
Wrench,
} from "phosphor-svelte";
import type { Component } from "svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { cn } from "$lib/utils.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

interface Props {
projectPath: string | null;
currentBranch: string | null;
diffStats: { insertions: number; deletions: number } | null;
isGitRepo: boolean | null;
isWorktree?: boolean;
onBranchSelected?: (branch: string) => void;
onInitGitRepo?: () => void;
/** "minimal" = pill triggers, no border; "default" = standard. */
variant?: "default" | "minimal";
}

let {
projectPath,
currentBranch,
diffStats,
isGitRepo,
isWorktree = false,
onBranchSelected,
onInitGitRepo,
variant = "default",
}: Props = $props();

// Branch prefix options
interface BranchPrefix {
label: string;
value: string;
icon: Component;
color: string;
}

const BRANCH_PREFIXES: BranchPrefix[] = [
{ label: "None", value: "", icon: GitBranch, color: Colors.purple },
{ label: "feat", value: "feat/", icon: Sparkle, color: "var(--success)" },
{ label: "fix", value: "fix/", icon: Bug, color: Colors.red },
{ label: "chore", value: "chore/", icon: Wrench, color: Colors.orange },
{ label: "refactor", value: "refactor/", icon: Recycle, color: Colors.cyan },
{ label: "docs", value: "docs/", icon: BookOpen, color: Colors.yellow },
{ label: "test", value: "test/", icon: TestTube, color: Colors.pink },
];

let branchPopoverOpen = $state(false);
let branchQuery = $state("");
let branches = $state<string[]>([]);
let loadingBranches = $state(false);
let switchingBranch = $state(false);
let branchInputRef = $state<HTMLInputElement | null>(null);
let branchLoadFailed = $state(false);

// Create branch dialog
let createBranchDialogOpen = $state(false);
let newBranchName = $state("");
let selectedPrefix = $state(BRANCH_PREFIXES[0]);
let prefixDropdownOpen = $state(false);
let newBranchInputRef = $state<HTMLInputElement | null>(null);

const normalizedNewBranchName = $derived(newBranchName.trim());
const fullBranchName = $derived(selectedPrefix.value + normalizedNewBranchName);

const newBranchExists = $derived.by(() =>
branches.some((branch) => branch.toLowerCase() === fullBranchName.toLowerCase())
);

const newBranchNameError = $derived.by(() => {
if (normalizedNewBranchName.length === 0) return null;
if (newBranchExists) return "Branch already exists";
if (normalizedNewBranchName.endsWith("/")) return 'Branch name cannot end with "/"';
if (normalizedNewBranchName.includes(" ")) return "Branch name cannot contain spaces";
return null;
});

const canCreateBranch = $derived.by(() => {
return normalizedNewBranchName.length > 0 && !newBranchNameError && !switchingBranch;
});

$effect(() => {
if (!branchPopoverOpen) {
branchQuery = "";
return;
}
queueMicrotask(() => {
branchInputRef?.focus();
});
if (!projectPath) {
branches = [];
return;
}
// Worktrees are tied to a specific branch — skip the Tauri call
if (isWorktree) {
branches = currentBranch ? [currentBranch] : [];
loadingBranches = false;
return;
}
loadingBranches = true;
branchLoadFailed = false;
let cancelled = false;
void tauriClient.git.listBranches(projectPath).match(
(availableBranches) => {
if (cancelled) return;
branches = availableBranches;
loadingBranches = false;
},
(error) => {
if (cancelled) return;
loadingBranches = false;
branchLoadFailed = true;
const message = error.cause?.message || error.message || "Failed to list branches";
toast.error(message);
}
);
return () => {
cancelled = true;
};
});

function handleSwitchBranch(branch: string, create: boolean): void {
if (!projectPath || switchingBranch) return;

switchingBranch = true;
void tauriClient.git.checkoutBranch(projectPath, branch, create).match(
(selectedBranch) => {
switchingBranch = false;
onBranchSelected?.(selectedBranch);
branchPopoverOpen = false;
createBranchDialogOpen = false;
},
(error) => {
switchingBranch = false;
const message = error.cause?.message || error.message || "Failed to switch branch";
toast.error(message);
}
);
}

function handleCreateBranch(): void {
if (!canCreateBranch) return;
handleSwitchBranch(fullBranchName, true);
}

function openCreateBranchDialog(): void {
branchPopoverOpen = false;
newBranchName = "";
selectedPrefix = BRANCH_PREFIXES[0];
createBranchDialogOpen = true;
queueMicrotask(() => newBranchInputRef?.focus());
}
</script>

<BranchPickerView
bind:open={branchPopoverOpen}
bind:query={branchQuery}
bind:searchInputRef={branchInputRef}
{currentBranch}
{diffStats}
{branches}
disabled={!projectPath}
{loadingBranches}
{branchLoadFailed}
{isWorktree}
isNotGitRepo={isGitRepo === false}
canInitGitRepo={Boolean(projectPath) && Boolean(onInitGitRepo)}
{variant}
onSelectBranch={(branch) => handleSwitchBranch(branch, false)}
onCreateNewBranch={openCreateBranchDialog}
onInitGitRepo={() => onInitGitRepo?.()}
/>

<!-- Create branch dialog -->
<Dialog.Root bind:open={createBranchDialogOpen}>
<Dialog.Content class="max-w-md rounded-2xl">
<Dialog.Header>
<Dialog.Title>Create and checkout branch</Dialog.Title>
</Dialog.Header>
<div class="space-y-3 py-2">
<label for="new-branch-name" class="text-sm font-medium">Branch name</label>
<div class="flex items-stretch">
<DropdownMenu.Root bind:open={prefixDropdownOpen}>
<DropdownMenu.Trigger>
{#snippet child({ props })}
<button
{...props}
type="button"
class="flex items-center gap-1.5 rounded-l-md border border-r-0 border-border bg-muted/50 px-2.5 text-xs hover:bg-accent transition-colors shrink-0"
>
<selectedPrefix.icon
class="h-3.5 w-3.5 shrink-0"
weight="fill"
style="color: {selectedPrefix.color}"
/>
<span class="font-mono">{selectedPrefix.value || "\u2014"}</span>
<ChevronDown
class={cn(
"h-3 w-3 text-muted-foreground transition-transform duration-200",
prefixDropdownOpen && "rotate-180"
)}
/>
</button>
{/snippet}
</DropdownMenu.Trigger>
<DropdownMenu.Content align="start" sideOffset={4} class="min-w-[10rem]">
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
</DropdownMenu.Content>
</DropdownMenu.Root>

<Input
id="new-branch-name"
bind:ref={newBranchInputRef}
bind:value={newBranchName}
placeholder="my-feature"
class="rounded-l-none font-mono"
onkeydown={(event) => {
if (event.key === "Enter") {
event.preventDefault();
handleCreateBranch();
}
}}
/>
</div>
{#if newBranchNameError}
<p class="text-[12px] text-destructive">{newBranchNameError}</p>
{/if}
</div>
<Dialog.Footer>
<Button variant="ghost" class="rounded-lg" onclick={() => (createBranchDialogOpen = false)}>
Close
</Button>
<Button class="rounded-lg" disabled={!canCreateBranch} onclick={handleCreateBranch}>
Create and checkout
</Button>
</Dialog.Footer>
</Dialog.Content>
</Dialog.Root>
