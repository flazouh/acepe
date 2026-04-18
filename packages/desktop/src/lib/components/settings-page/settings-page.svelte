<script lang="ts">
import { X } from "phosphor-svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import * as m from "$lib/messages.js";
import AgentsModelsSection from "./sections/agents-models-section.svelte";
import AppearanceSection from "./sections/appearance-section.svelte";
import ArchivedSessionsSection from "./sections/archived-sessions-section.svelte";
import ChatSection from "./sections/chat-section.svelte";
import EnvironmentsSection from "./sections/environments-section.svelte";
import GeneralSection from "./sections/general-section.svelte";
import GitSection from "./sections/git-section.svelte";
import KeybindingsSection from "./sections/keybindings-section.svelte";
import McpSection from "./sections/mcp-section.svelte";
import SkillsSection from "./sections/skills-section.svelte";
import UsageSection from "./sections/usage-section.svelte";
import VoiceSection from "./sections/voice-section.svelte";
import WorktreesSection from "./sections/worktrees-section.svelte";
import SettingsSidebar from "./settings-sidebar.svelte";
import { migrateSettingsSectionId, type SettingsSectionId } from "./settings-types.js";

interface Props {
	projectManager?: ProjectManager;
	onClose?: () => void;
	initialSection?: string;
}

let { projectManager, onClose, initialSection }: Props = $props();

let activeSection = $state<SettingsSectionId>(
	initialSection ? migrateSettingsSectionId(initialSection) : "general"
);

function handleSectionChange(section: SettingsSectionId) {
	activeSection = section;
}
</script>

<div class="relative h-full w-full flex bg-background overflow-hidden gap-1 p-1">
	<!-- Floating sidebar (full height) -->
	<SettingsSidebar {activeSection} onSectionChange={handleSectionChange} />

	<!-- Floating close button -->
	<button
		type="button"
		class="absolute right-1 top-1 z-10 flex items-center justify-center size-5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
		title={m.common_close()}
		aria-label={m.common_close()}
		onclick={() => onClose?.()}
	>
		<X class="size-3.5" weight="bold" />
	</button>

	<div class="flex flex-1 min-w-0 min-h-0 flex-col">
		<!-- Main content -->
		<main class="flex-1 min-w-0 min-h-0 overflow-auto px-14 pt-8 pb-14 text-[13px] lg:px-16 lg:pt-10 lg:pb-16 xl:px-20 xl:pt-12 xl:pb-20">
			{#if activeSection === "general"}
				<GeneralSection />
			{:else if activeSection === "appearance"}
				<AppearanceSection />
			{:else if activeSection === "agents"}
				<AgentsModelsSection />
			{:else if activeSection === "chat"}
				<ChatSection />
			{:else if activeSection === "voice"}
				<VoiceSection />
			{:else if activeSection === "skills"}
				<SkillsSection />
			{:else if activeSection === "keybindings"}
				<KeybindingsSection />
			{:else if activeSection === "mcp"}
				<McpSection />
			{:else if activeSection === "git"}
				<GitSection />
			{:else if activeSection === "environments"}
				<EnvironmentsSection />
			{:else if activeSection === "worktrees"}
				<WorktreesSection />
			{:else if activeSection === "archived"}
				{#if projectManager}
					<ArchivedSessionsSection {projectManager} />
				{:else}
					<div class="text-[12px] text-muted-foreground/50">
						Archived sessions are only available from the main app view.
					</div>
				{/if}
			{:else if activeSection === "usage"}
				<UsageSection />
			{/if}
		</main>
	</div>
</div>
