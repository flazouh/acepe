<script lang="ts">
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
import SettingsPageHeader from "./settings-page-header.svelte";
import { getSettingsSectionDefinition } from "./settings-section-registry.js";
import SettingsSidebar from "./settings-sidebar.svelte";
import { migrateSettingsSectionId, type SettingsSectionId } from "./settings-types.js";

interface Props {
	projectManager?: ProjectManager;
	initialSection?: string;
}

let { projectManager, initialSection }: Props = $props();

// One-time seed from optional `initialSection`; user tab changes are local only after that.
// svelte-ignore state_referenced_locally
let activeSection = $state<SettingsSectionId>(
	initialSection != null && initialSection !== ""
		? migrateSettingsSectionId(initialSection)
		: "general"
);

const activeSectionDefinition = $derived(getSettingsSectionDefinition(activeSection));

function handleSectionChange(section: SettingsSectionId) {
	activeSection = section;
}
</script>

<div class="relative flex h-full min-h-0 w-full overflow-hidden">
	<SettingsSidebar {activeSection} onSectionChange={handleSectionChange} />

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<SettingsPageHeader
			title={activeSectionDefinition.label}
			description={activeSectionDefinition.description}
		/>

		<main class="min-h-0 flex-1 overflow-auto p-4">
			<div
				class={activeSectionDefinition.fullWidth === true
					? "flex h-full min-h-0 w-full flex-col"
					: "w-full max-w-4xl"}
			>
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
						<p class="text-[12px] text-muted-foreground/70">
							Project settings are only available from the main app view.
						</p>
					{/if}
				{:else if activeSection === "environments"}
					<EnvironmentsSection />
				{:else if activeSection === "worktrees"}
					<WorktreesSection />
				{:else if activeSection === "archived"}
					{#if projectManager}
						<ArchivedSessionsSection {projectManager} />
					{:else}
						<p class="text-[12px] text-muted-foreground/70">
							Archived sessions are only available from the main app view.
						</p>
					{/if}
				{:else if activeSection === "usage"}
					<UsageSection />
				{/if}
			</div>
		</main>
	</div>
</div>
