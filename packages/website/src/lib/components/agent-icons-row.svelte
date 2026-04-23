<script lang="ts">
import { websiteThemeStore } from "$lib/theme/theme.js";
import { cn } from "$lib/utils.js";

const AGENTS: {
	id: string;
	alt: string;
	iconPath: (theme: "light" | "dark") => string;
	sizeMultiplier?: number;
}[] = [
	{
		id: "claude-code",
		alt: "Claude",
		iconPath: (theme) => `/svgs/agents/claude/claude-icon-${theme}.svg`,
	},
	{
		id: "codex",
		alt: "Codex",
		iconPath: (theme) => `/svgs/agents/codex/codex-icon-${theme}.svg`,
	},
	{
		id: "cursor",
		alt: "Cursor",
		iconPath: (theme) => `/svgs/agents/cursor/cursor-icon-${theme}.svg`,
		sizeMultiplier: 0.88,
	},
	{
		id: "copilot",
		alt: "Copilot",
		iconPath: (theme) => `/svgs/agents/copilot/copilot-icon-${theme}.svg`,
		sizeMultiplier: 0.88,
	},
	{
		id: "opencode",
		alt: "OpenCode",
		iconPath: (theme) => `/svgs/agents/opencode/opencode-logo-${theme}.svg`,
		sizeMultiplier: 0.88,
	},
];

interface Props {
	size?: number;
	class?: string;
}

let { size = 20, class: className = "" }: Props = $props();

const theme = $derived($websiteThemeStore);
</script>

<div class={cn('flex items-center justify-center gap-2', className)}>
	{#each AGENTS as agent (agent.id)}
		<div class="flex shrink-0 items-center justify-center" style="width: {size}px; height: {size}px;">
			<img
				src={agent.iconPath(theme)}
				alt={agent.alt}
				width={Math.round(size * (agent.sizeMultiplier ?? 1))}
				height={Math.round(size * (agent.sizeMultiplier ?? 1))}
				class="max-h-full max-w-full object-contain"
			/>
		</div>
	{/each}
</div>
