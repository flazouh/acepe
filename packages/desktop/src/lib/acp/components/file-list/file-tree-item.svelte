<script lang="ts">
import { DiffPill } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconChevronRight } from "@tabler/icons-svelte";
import { IconCopy } from "@tabler/icons-svelte";
import { IconDots } from "@tabler/icons-svelte";
import { IconFilePlus } from "@tabler/icons-svelte";
import { IconPencil } from "@tabler/icons-svelte";
import { IconRotateClockwise } from "@tabler/icons-svelte";
import { IconTrash } from "@tabler/icons-svelte";
import { CheckCircle } from "phosphor-svelte";
import { FolderOpen } from "phosphor-svelte";
import { FolderPlus } from "phosphor-svelte";
import { XCircle } from "phosphor-svelte";
import { tick } from "svelte";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";
import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
import * as m from "$lib/messages.js";
import FileIcon from "./file-icon.svelte";
import type { FileTreeNode } from "./file-list-types.js";

interface Props {
	node: FileTreeNode;
	projectPath: string;
	isExpanded: boolean;
	onToggleFolder: (projectPath: string, folderPath: string) => void;
	onSelectFile: (filePath: string, projectPath: string) => void;
	onCopyPath?: (fullPath: string, relativePath: string) => void;
	onRevealInFinder?: (fullPath: string) => void;
	onRefresh?: () => void;
	onDelete?: (
		projectPath: string,
		relativePath: string,
		name: string,
		isDirectory: boolean
	) => void;
	/** Called when user confirms delete (inline). Performs the actual delete. */
	onDeleteConfirm?: (projectPath: string, relativePath: string) => void;
	/** Called when user confirms rename with new name. Performs the actual rename. */
	onRename?: (projectPath: string, relativePath: string, newName: string) => void;
	onDuplicate?: (projectPath: string, relativePath: string) => void;
	onNewFile?: (projectPath: string, parentRelativePath: string) => void;
	onNewFolder?: (projectPath: string, parentRelativePath: string) => void;
}

let {
	node,
	projectPath,
	isExpanded,
	onToggleFolder,
	onSelectFile,
	onCopyPath,
	onRevealInFinder,
	onRefresh,
	onDelete,
	onDeleteConfirm,
	onRename,
	onDuplicate,
	onNewFile,
	onNewFolder,
}: Props = $props();

const fullPath = $derived(projectPath.replace(/\/$/, "") + (node.path ? `/${node.path}` : ""));

function handleClick() {
	if (isRenaming) return;
	if (node.isDirectory) {
		onToggleFolder(projectPath, node.path);
	} else {
		onSelectFile(node.path, projectPath);
	}
}

function handleKeyDown(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		handleClick();
	}
}

function handleRevealInFinder() {
	onRevealInFinder?.(fullPath);
}

function handleRefresh() {
	onRefresh?.();
}

function handleDelete() {
	onDelete?.(projectPath, node.path, node.name, node.isDirectory);
}

function handleDeleteConfirm() {
	onDeleteConfirm?.(projectPath, node.path);
}

function handleRename() {
	renameInput = node.name;
	isRenaming = true;
	tick().then(() => {
		renameInputRef?.focus();
		renameInputRef?.select();
	});
}

function handleRenameKeydown(event: KeyboardEvent) {
	if (event.key === "Enter") {
		event.preventDefault();
		submitRename();
	} else if (event.key === "Escape") {
		event.preventDefault();
		cancelRename();
	}
}

function submitRename() {
	const trimmed = renameInput.trim();
	if (trimmed && trimmed !== node.name) {
		onRename?.(projectPath, node.path, trimmed);
	}
	isRenaming = false;
}

function cancelRename() {
	isRenaming = false;
}

function handleDuplicate() {
	onDuplicate?.(projectPath, node.path);
}

function handleNewFile() {
	const parent = node.isDirectory
		? node.path
		: node.path.includes("/")
			? node.path.replace(/\/[^/]+$/, "")
			: "";
	onNewFile?.(projectPath, parent);
}

function handleNewFolder() {
	const parent = node.isDirectory
		? node.path
		: node.path.includes("/")
			? node.path.replace(/\/[^/]+$/, "")
			: "";
	onNewFolder?.(projectPath, parent);
}

const indentPx = $derived(node.depth * 12);

const nameColor = $derived.by(() => {
	if (node.isDirectory) {
		return node.hasModifiedDescendants ? "#E2BF8D" : null;
	}
	const status = node.gitStatus?.status;
	if (status === "M") return "#E2BF8D";
	if (status === "A" || status === "?") return "var(--success)";
	if (status === "D") return "#FF5D5A";
	if (status === "R") return "#E2BF8D";
	return null;
});

const hasDiff = $derived(
	!!node.gitStatus && (node.gitStatus.insertions > 0 || node.gitStatus.deletions > 0)
);

let deleteConfirming = $state(false);
let isRenaming = $state(false);
let renameInput = $state("");
let renameInputRef = $state<HTMLInputElement | undefined>(undefined);

function handleDeleteClick(event: Event & { preventDefault?: () => void }) {
	event?.preventDefault?.();
	deleteConfirming = true;
}
</script>

<ContextMenu.Root
	onOpenChange={(open) => {
		if (!open) deleteConfirming = false;
	}}
>
	<ContextMenu.Trigger>
		<div
			class="file-tree-item group flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-muted/30 focus-within:bg-muted/30 transition-colors"
			style="padding-left: {indentPx + 8}px"
		>
			{#if isRenaming && onRename}
				<div class="flex flex-1 min-w-0 items-center gap-1" role="group">
					{#if node.isDirectory}
						<span
							class="flex h-4 w-4 shrink-0 items-center justify-center transition-transform duration-150"
							class:rotate-90={isExpanded}
						>
							<IconChevronRight class="h-3 w-3 text-muted-foreground" />
						</span>
					{:else}
						<span class="h-4 w-4 shrink-0"></span>
					{/if}
					<FileIcon
						extension={node.extension}
						isDirectory={node.isDirectory}
						{isExpanded}
						class="h-4 w-4 shrink-0"
					/>
					<input
						bind:this={renameInputRef}
						bind:value={renameInput}
						onkeydown={handleRenameKeydown}
						class="min-w-0 flex-1 rounded border border-input bg-background px-0.5 py-0 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
					/>
					<button
						type="button"
						class="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						aria-label={m.common_cancel()}
						onclick={() => cancelRename()}
					>
						<XCircle weight="fill" class="h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						class="shrink-0 rounded p-0.5 text-success hover:bg-success/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						aria-label={m.common_confirm()}
						onclick={() => submitRename()}
					>
						<CheckCircle weight="fill" class="h-3.5 w-3.5" />
					</button>
				</div>
			{:else}
				<button
					type="button"
					class="flex flex-1 min-w-0 items-center gap-1 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
					onclick={handleClick}
					onkeydown={handleKeyDown}
					aria-expanded={node.isDirectory ? isExpanded : undefined}
				>
					{#if node.isDirectory}
						<span
							class="flex h-4 w-4 shrink-0 items-center justify-center transition-transform duration-150"
							class:rotate-90={isExpanded}
						>
							<IconChevronRight class="h-3 w-3 text-muted-foreground" />
						</span>
					{:else}
						<span class="h-4 w-4 shrink-0"></span>
					{/if}
					<FileIcon
						extension={node.extension}
						isDirectory={node.isDirectory}
						{isExpanded}
						class="h-4 w-4 shrink-0"
					/>
					<span class="truncate" style:color={nameColor}>{node.name}</span>
				</button>
				{#if hasDiff && node.gitStatus}
					<DiffPill
						insertions={node.gitStatus.insertions}
						deletions={node.gitStatus.deletions}
						variant="plain"
						class="ml-auto shrink-0"
					/>
				{/if}
			{/if}
			{#if !isRenaming && (onCopyPath || onRevealInFinder || onRefresh || onDelete || onDeleteConfirm || onRename || onDuplicate || onNewFile || onNewFolder)}
				<DropdownMenu.Root
					onOpenChange={(open) => {
						if (!open) deleteConfirming = false;
					}}
				>
					<DropdownMenu.Trigger
						class="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground hover:text-foreground transition-opacity hover:bg-muted data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto"
						onclick={(e) => e.stopPropagation()}
					>
						<IconDots class="h-3.5 w-3.5" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							align="end"
							side="bottom"
							class="w-44 rounded-lg px-1 py-1 text-xs"
						>
							{#if onCopyPath}
								<DropdownMenu.Item
									class="group/item !py-1 cursor-pointer data-[highlighted]:[&_svg]:!text-primary"
								>
									<CopyButton
										text={fullPath}
										variant="menu"
										label={m.file_list_copy_path()}
										size={12}
									/>
								</DropdownMenu.Item>
							{/if}
							{#if onRevealInFinder}
								<DropdownMenu.Item
									onSelect={handleRevealInFinder}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<FolderOpen class="h-3 w-3 shrink-0" weight="fill" />
									{m.file_list_reveal_in_finder()}
								</DropdownMenu.Item>
							{/if}
							{#if onRefresh}
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onSelect={handleRefresh}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<IconRotateClockwise class="h-3 w-3 shrink-0" />
									{m.file_list_refresh()}
								</DropdownMenu.Item>
							{/if}
							{#if onRename}
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onSelect={handleRename}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<IconPencil class="h-3 w-3 shrink-0" />
									{m.file_list_rename()}
								</DropdownMenu.Item>
							{/if}
							{#if onDuplicate && !node.isDirectory}
								<DropdownMenu.Item
									onSelect={handleDuplicate}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<IconCopy class="h-3 w-3 shrink-0" />
									{m.file_list_duplicate()}
								</DropdownMenu.Item>
							{/if}
							{#if onNewFile}
								<DropdownMenu.Item
									onSelect={handleNewFile}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<IconFilePlus class="h-3 w-3 shrink-0" />
									{m.file_list_new_file()}
								</DropdownMenu.Item>
							{/if}
							{#if onNewFolder}
								<DropdownMenu.Item
									onSelect={handleNewFolder}
									class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
								>
									<FolderPlus class="h-3 w-3 shrink-0" weight="fill" />
									{m.file_list_new_folder()}
								</DropdownMenu.Item>
							{/if}
							{#if onDeleteConfirm}
								<DropdownMenu.Separator />
								{#if deleteConfirming}
									<DropdownMenu.Item
										onSelect={() => {
											deleteConfirming = false;
										}}
										class="!py-1 !text-success data-[highlighted]:bg-success/10 dark:data-[highlighted]:bg-success/20 data-[highlighted]:!text-success data-[highlighted]:[&_svg]:!text-success"
									>
										<XCircle weight="fill" class="h-3 w-3 shrink-0 text-success" />
										{m.common_cancel()}
									</DropdownMenu.Item>
									<DropdownMenu.Item
										variant="destructive"
										class="!py-1"
										onSelect={() => {
											deleteConfirming = false;
											handleDeleteConfirm();
										}}
									>
										<CheckCircle weight="fill" class="h-3 w-3 shrink-0" />
										{m.common_confirm()}
									</DropdownMenu.Item>
								{:else}
									<DropdownMenu.Item
										class="!py-1 text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 dark:data-[highlighted]:bg-destructive/20 data-[highlighted]:text-destructive data-[highlighted]:[&_svg]:!text-destructive"
										onSelect={handleDeleteClick}
									>
										<IconTrash class="h-3 w-3 shrink-0 text-destructive" />
										{m.file_list_delete()}
									</DropdownMenu.Item>
								{/if}
							{:else if onDelete}
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									class="!py-1 text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 dark:data-[highlighted]:bg-destructive/20 data-[highlighted]:text-destructive data-[highlighted]:[&_svg]:!text-destructive"
									onSelect={handleDelete}
								>
									<IconTrash class="h-3 w-3 shrink-0" />
									{m.file_list_delete()}
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{/if}
		</div>
	</ContextMenu.Trigger>
	<ContextMenu.Content>
		{#if onCopyPath}
			<ContextMenu.Item
				class="group/item !py-1 cursor-pointer data-[highlighted]:[&_svg]:!text-primary"
			>
				<CopyButton text={fullPath} variant="menu" label={m.file_list_copy_path()} size={12} />
			</ContextMenu.Item>
		{/if}
		{#if onRevealInFinder}
			<ContextMenu.Item
				onSelect={handleRevealInFinder}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<FolderOpen class="h-3 w-3 shrink-0" weight="fill" />
				{m.file_list_reveal_in_finder()}
			</ContextMenu.Item>
		{/if}
		{#if onRefresh}
			<ContextMenu.Separator />
			<ContextMenu.Item
				onSelect={handleRefresh}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<IconRotateClockwise class="h-3 w-3 shrink-0" />
				{m.file_list_refresh()}
			</ContextMenu.Item>
		{/if}
		{#if onRename}
			<ContextMenu.Separator />
			<ContextMenu.Item
				onSelect={handleRename}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<IconPencil class="h-3 w-3 shrink-0" />
				{m.file_list_rename()}
			</ContextMenu.Item>
		{/if}
		{#if onDuplicate && !node.isDirectory}
			<ContextMenu.Item
				onSelect={handleDuplicate}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<IconCopy class="h-3 w-3 shrink-0" />
				{m.file_list_duplicate()}
			</ContextMenu.Item>
		{/if}
		{#if onNewFile}
			<ContextMenu.Item
				onSelect={handleNewFile}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<IconFilePlus class="h-3 w-3 shrink-0" />
				{m.file_list_new_file()}
			</ContextMenu.Item>
		{/if}
		{#if onNewFolder}
			<ContextMenu.Item
				onSelect={handleNewFolder}
				class="group/item !py-1 data-[highlighted]:[&_svg]:!text-primary"
			>
				<FolderPlus class="h-3 w-3 shrink-0" weight="fill" />
				{m.file_list_new_folder()}
			</ContextMenu.Item>
		{/if}
		{#if onDeleteConfirm}
			<ContextMenu.Separator />
			{#if deleteConfirming}
				<ContextMenu.Item
					onSelect={() => {
						deleteConfirming = false;
					}}
					class="!py-1 !text-success data-[highlighted]:bg-success/10 dark:data-[highlighted]:bg-success/20 data-[highlighted]:!text-success data-[highlighted]:[&_svg]:!text-success"
				>
					<XCircle weight="fill" class="h-3 w-3 shrink-0 text-success" />
					{m.common_cancel()}
				</ContextMenu.Item>
				<ContextMenu.Item
					variant="destructive"
					class="!py-1"
					onSelect={() => {
						deleteConfirming = false;
						handleDeleteConfirm();
					}}
				>
					<CheckCircle weight="fill" class="h-3 w-3 shrink-0" />
					{m.common_confirm()}
				</ContextMenu.Item>
			{:else}
				<ContextMenu.Item
					class="!py-1 text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 dark:data-[highlighted]:bg-destructive/20 data-[highlighted]:text-destructive data-[highlighted]:[&_svg]:!text-destructive"
					onSelect={handleDeleteClick}
				>
					<IconTrash class="h-3 w-3 shrink-0" />
					{m.file_list_delete()}
				</ContextMenu.Item>
			{/if}
		{:else if onDelete}
			<ContextMenu.Separator />
			<ContextMenu.Item
				class="!py-1 text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 dark:data-[highlighted]:bg-destructive/20 data-[highlighted]:text-destructive data-[highlighted]:[&_svg]:!text-destructive"
				onSelect={handleDelete}
			>
				<IconTrash class="h-3 w-3 shrink-0" />
				{m.file_list_delete()}
			</ContextMenu.Item>
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>
