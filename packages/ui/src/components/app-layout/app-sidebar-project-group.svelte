<script lang="ts">
import type { Snippet } from "svelte";

import { cn } from "../../lib/utils.js";
import { ProjectLetterBadge } from "../project-letter-badge/index.js";
import AppSessionItem from "./app-session-item.svelte";
import type { AppProjectGroup } from "./types.js";

interface SharedProps {
	header?: Snippet;
	children?: Snippet;
	footer?: Snippet;
	style?: string;
	class?: string;
}

type Props = SharedProps &
	(
		| { projectName: string; group?: AppProjectGroup }
		| { projectName?: never; group: AppProjectGroup }
	);

let {
	projectName,
	group,
	header,
	children,
	footer,
	style,
	class: className = "",
}: Props = $props();

// Prefer the explicit prop; fall back to the group name so the container is
// always an accessibly-named region even when only a group is supplied.
const accessibleName = $derived(projectName ?? group?.name ?? "Project");
</script>

<!--
	Workspace container: one full-width surface per project. Separation comes from
	a quiet fill + shape, never borders, shadows, or large color fills. It reuses
	the quiet input-surface family (bg-input wash) so the shell reads with the same
	recessed fill language as tool cards, distinct from selected-row accent tint.
	The header is the top band; session content is inset within the same surface.
	Collapsed groups render an empty content region that adds no height, so they
	stay compact.
-->
<div
	role="group"
	aria-label={accessibleName}
	data-sidebar-project-surface
	class={cn(
		"flex flex-col overflow-hidden rounded-md bg-input/30",
		className
	)}
	{style}
>
	<div data-sidebar-project-header class="shrink-0">
		{#if header}
			{@render header()}
		{:else if group}
			<div class="flex items-center">
				<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
					<ProjectLetterBadge
						name={group.name}
						label={group.badgeLabel ?? null}
						color={group.color ?? "#6B7280"}
						iconSrc={group.iconSrc ?? null}
						size={16}
					/>
				</div>
				<div class="flex items-center flex-1 min-w-0 h-7 pl-1.5 pr-2">
					<span class="text-[11px] font-medium text-foreground truncate">{group.name}</span>
				</div>
			</div>
		{/if}
	</div>

	<div data-sidebar-project-content class="flex flex-col flex-1 min-h-0 min-w-0 px-1">
		{#if children}
			{@render children()}
		{:else if group}
			<div class="flex-1 min-h-0 overflow-auto">
				<div class="flex flex-col gap-0.5 pb-1">
					{#each group.sessions as session (session.id)}
						<AppSessionItem {session} />
					{/each}
				</div>
			</div>
		{/if}
	</div>

	{#if footer}
		{@render footer()}
	{/if}
</div>
