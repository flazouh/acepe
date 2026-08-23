<script lang="ts">
	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import type {
		ComposerSetupBarServer,
		ComposerSetupBarSkill,
	} from "./composer-setup-bar-state.js";

	interface Props {
		skillsHeading: string;
		mcpHeading: string;
		optionsHeading: string;
		skills: ReadonlyArray<ComposerSetupBarSkill>;
		servers: ReadonlyArray<ComposerSetupBarServer>;
		configOptions: ReadonlyArray<AgentInputConfigOption>;
		onOptionValueChange: (optionId: string, value: string) => void;
	}

	let {
		skillsHeading,
		mcpHeading,
		optionsHeading,
		skills,
		servers,
		configOptions,
		onOptionValueChange,
	}: Props = $props();
</script>

<div
	data-testid="new-thread-options"
	class="flex max-w-full flex-wrap items-center gap-2 px-3 py-2 text-xs"
>
	<div data-testid="skills-catalog" class="flex flex-wrap items-center gap-1">
		<span class="text-muted-foreground">{skillsHeading}</span>
		{#each skills as skill (skill.id)}
			<span data-testid="skill-row" data-skill-id={skill.id} class="rounded-md bg-secondary px-2 py-1">
				{skill.name}
			</span>
		{/each}
	</div>
	<div data-testid="mcp-catalog" class="flex flex-wrap items-center gap-1">
		<span class="text-muted-foreground">{mcpHeading}</span>
		{#each servers as server (server.id)}
			<span
				data-testid="mcp-server-row"
				data-server-id={server.id}
				class="rounded-md bg-secondary px-2 py-1"
			>
				{server.name}
			</span>
		{/each}
	</div>
	<div class="flex flex-wrap items-center gap-1">
		<span class="text-muted-foreground">{optionsHeading}</span>
		{#each configOptions as configOption (configOption.id)}
			<div data-testid="preconnection-option" data-option-id={configOption.id}>
				<AgentInputConfigOptionSelector
					{configOption}
					onValueChange={onOptionValueChange}
				/>
			</div>
		{/each}
	</div>
</div>
