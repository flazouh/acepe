<script lang="ts">
import { Copy, FileText, Lock, Puzzle } from "@lucide/svelte/icons";
import { Button } from "$lib/components/ui/button/index.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";

import { getSkillsStore } from "../store/skills-store.svelte.js";

const store = getSkillsStore();

function handleChange(value: string) {
	// Only allow changes for regular skills, not plugin skills
	if (!store.isPluginSkillSelected) {
		store.setEditorContent(value);
	}
}

// Handle Cmd/Ctrl+S globally for the editor
function handleKeyDown(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key === "s") {
		event.preventDefault();
		if (store.isDirty && !store.isPluginSkillSelected) {
			store.saveSkill();
		}
	}
}

function handleCopyToClaudeCode() {
	if (store.selectedPluginSkill) {
		store.copyPluginSkillToAgent(store.selectedPluginSkill.id, "claude-code");
	}
}
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="h-full flex flex-col">
	{#if store.isPluginSkillSelected && store.selectedPluginSkill}
		<!-- Plugin skill banner -->
		<div
			class="flex items-center justify-between gap-2 px-3 py-2 bg-purple-500/10 border-b border-purple-500/20"
		>
			<div class="flex items-center gap-2 text-sm">
				<Puzzle class="h-4 w-4 text-purple-500" />
				<span class="text-purple-600 dark:text-purple-400 font-medium">Plugin Skill</span>
				<Lock class="h-3 w-3 text-muted-foreground" />
				<span class="text-muted-foreground text-xs">Read-only</span>
			</div>
			<Button variant="outline" size="sm" onclick={handleCopyToClaudeCode} class="h-7 text-xs">
				<Copy class="h-3 w-3 mr-1" />
				Copy to Claude Code
			</Button>
		</div>
		<CodeMirrorEditor
			value={store.editorContent}
			language="markdown"
			onChange={handleChange}
			readonly={true}
		/>
	{:else if store.selectedSkill}
		<CodeMirrorEditor value={store.editorContent} language="markdown" onChange={handleChange} />
	{:else}
		<div class="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
			<FileText class="h-12 w-12 opacity-50" />
			<p class="text-sm">Select a skill to view or edit</p>
		</div>
	{/if}
</div>
