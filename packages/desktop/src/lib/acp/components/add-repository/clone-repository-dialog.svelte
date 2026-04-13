<script lang="ts">
import { FolderOpen } from "phosphor-svelte";
import { GitBranch } from "phosphor-svelte";
import { Link } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button/index.js";
import * as Dialog from "$lib/components/ui/dialog/index.js";
import { Input } from "$lib/components/ui/input/index.js";
import { Label } from "$lib/components/ui/label/index.js";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/messages.js";
import { tauriClient } from "$lib/utils/tauri-client.js";

import type { CloneRepositoryDialogProps } from "./clone-repository-dialog-props.js";

let { open, onOpenChange, onCloneComplete }: CloneRepositoryDialogProps = $props();

let url = $state("");
let destination = $state("");
let branch = $state("main");
let cloning = $state(false);

let isValid = $derived(url.trim().length > 0 && destination.trim().length > 0);

function resetForm() {
	url = "";
	destination = "";
	branch = "main";
	cloning = false;
}

async function handleBrowse() {
	const result = await tauriClient.git.browseDestination();
	result.match(
		(path) => {
			if (path) {
				destination = path;
			}
		},
		(error) => {
			console.error("Failed to browse for destination:", error);
			toast.error(m.clone_repository_browse_error());
		}
	);
}

async function handleClone() {
	if (!isValid) return;

	cloning = true;

	const branchToUse = branch.trim() || undefined;
	const result = await tauriClient.git.clone(url.trim(), destination.trim(), branchToUse);

	result.match(
		(cloneResult) => {
			toast.success(m.clone_repository_success());
			onCloneComplete(cloneResult.path, cloneResult.name);
			onOpenChange(false);
			resetForm();
		},
		(error) => {
			console.error("Clone failed:", error);
			toast.error(m.clone_repository_error({ error: error.message }));
			cloning = false;
		}
	);
}

function handleOpenChange(newOpen: boolean) {
	if (!cloning) {
		onOpenChange(newOpen);
		if (!newOpen) {
			resetForm();
		}
	}
}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.clone_repository_title()}</Dialog.Title>
			<Dialog.Description>{m.clone_repository_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<!-- URL Input -->
			<div class="space-y-2">
				<Label for="clone-url" class="flex items-center gap-2">
					<Link class="size-4" weight="bold" />
					{m.clone_repository_url_label()}
				</Label>
				<Input
					id="clone-url"
					placeholder={m.clone_repository_url_placeholder()}
					bind:value={url}
					disabled={cloning}
				/>
			</div>

			<!-- Destination Folder -->
			<div class="space-y-2">
				<Label for="clone-destination" class="flex items-center gap-2">
					<FolderOpen class="size-4" weight="bold" />
					{m.clone_repository_destination_label()}
				</Label>
				<div class="flex gap-2">
					<Input
						id="clone-destination"
						readonly
						value={destination}
						placeholder={m.clone_repository_destination_placeholder()}
						class="flex-1"
					/>
					<Button variant="outline" onclick={handleBrowse} disabled={cloning}>
						{m.clone_repository_browse()}
					</Button>
				</div>
			</div>

			<!-- Branch Input -->
			<div class="space-y-2">
				<Label for="clone-branch" class="flex items-center gap-2">
					<GitBranch class="size-4" weight="bold" />
					{m.clone_repository_branch_label()}
				</Label>
				<Input id="clone-branch" placeholder="main" bind:value={branch} disabled={cloning} />
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => handleOpenChange(false)} disabled={cloning}>
				{m.common_cancel()}
			</Button>
			<Button onclick={handleClone} disabled={!isValid || cloning}>
				{#if cloning}
					<Spinner class="size-4 mr-2" />
					{m.clone_repository_cloning()}
				{:else}
					{m.clone_repository_clone()}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
