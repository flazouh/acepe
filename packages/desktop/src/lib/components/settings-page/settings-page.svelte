<script lang="ts">
import { X } from "phosphor-svelte";
import type { ProjectManager } from "$lib/acp/logic/project-manager.svelte.js";
import AgentsModelsSection from "./sections/agents-models-section.svelte";
import AppearanceSection from "./sections/appearance-section.svelte";
import ArchivedSessionsSection from "./sections/archived-sessions-section.svelte";
import ChatSection from "./sections/chat-section.svelte";
import EnvironmentsSection from "./sections/environments-section.svelte";
import GeneralSection from "./sections/general-section.svelte";
import GitSection from "./sections/git-section.svelte";
import KeybindingsSection from "./sections/keybindings-section.svelte";
import McpSection from "./sections/mcp-section.svelte";
import ProjectSection from "./sections/project-section.svelte";
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

// One-time seed from optional `initialSection`; user tab changes are local only after that.
// svelte-ignore state_referenced_locally
let activeSection = $state<SettingsSectionId>(
	initialSection != null && initialSection !== ""
		? migrateSettingsSectionId(initialSection)
		: "general"
);

function handleSectionChange(section: SettingsSectionId) {
	activeSection = section;
}
</script>

<div class="relative h-full w-full flex bg-background overflow-hidden">
	<!-- Flush sidebar (full height) -->
	<SettingsSidebar {activeSection} onSectionChange={handleSectionChange} />

	<!-- Floating close button -->
	<button
		type="button"
		class="absolute right-3 top-3 z-10 flex items-center justify-center size-6 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
		title={"Close"}
		aria-label={"Close"}
		onclick={() => onClose?.()}
	>
		<X class="size-4" weight="bold" />
	</button>

	<div class="flex flex-1 min-w-0 min-h-0 flex-col">
		<!-- Main content -->
		<main class="flex-1 min-w-0 min-h-0 overflow-auto px-16 pt-10 pb-16 text-[13px] lg:px-20 lg:pt-12 lg:pb-20 xl:px-24 xl:pt-14 xl:pb-24">
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
			{:else if activeSection === "project"}
				{#if projectManager}
					<ProjectSection {projectManager} />
				{:else}
					<div class="text-[12px] text-muted-foreground/50">
						Project settings are only available from the main app view.
					</div>
				{/if}
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
