<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { MoreHorizontal } from "@lucide/svelte/icons";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
interface ProjectItem {
	path: string;
	name: string;
	color?: string;
}

interface Props {
	projects: ProjectItem[];
	hiddenProjects: Set<string>;
	onToggleProject: (projectPath: string) => void;
}

let { projects, hiddenProjects, onToggleProject }: Props = $props();

const visibleCount = $derived(projects.filter((p) => !hiddenProjects.has(p.path)).length);
const hasHiddenProjects = $derived(hiddenProjects.size > 0);
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<MoreHorizontal class="h-3.5 w-3.5" />
				{#if hasHiddenProjects}
					<span class="tabular-nums">{visibleCount}/{projects.length}</span>
				{/if}
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" class="w-56">
					<DropdownMenu.Label>{"Visible Projects"}</DropdownMenu.Label>
					<DropdownMenu.Separator />
					{#each projects as project (project.path)}
						{@const isVisible = !hiddenProjects.has(project.path)}
						<div class="flex items-center justify-between px-2 py-1.5 text-sm">
							<span class="truncate mr-2">{project.name}</span>
							<Switch checked={isVisible} onCheckedChange={() => onToggleProject(project.path)} />
						</div>
					{/each}
					{#if projects.length === 0}
						<div class="py-2 px-2 text-xs text-muted-foreground text-center">
							{"No projects"}
						</div>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	</Tooltip.Trigger>
	<Tooltip.Content>
		{"Filter projects"}
	</Tooltip.Content>
</Tooltip.Root>
