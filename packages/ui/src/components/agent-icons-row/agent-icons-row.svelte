<script lang="ts">
	import { cn } from "../../lib/utils.js";
	import type { AgentIconsRowTheme } from "./types.js";

	interface AgentIcon {
		readonly id: string;
		readonly alt: string;
		readonly iconPath: (theme: AgentIconsRowTheme) => string;
		readonly sizeMultiplier?: number;
	}

	const AGENTS: readonly AgentIcon[] = [
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
		theme?: AgentIconsRowTheme;
		size?: number;
		class?: string;
	}

	let { theme = "light", size = 20, class: className = "" }: Props = $props();
</script>

<div class={cn("flex items-center justify-center gap-2", className)}>
	{#each AGENTS as agent, index (agent.id)}
		<div
			class="agent-icon-pulse flex shrink-0 items-center justify-center"
			style="width: {size}px; height: {size}px; animation-delay: {index}s"
		>
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

<style>
	.agent-icon-pulse {
		animation: icon-pulse 4s ease-in-out infinite;
	}

	@keyframes icon-pulse {
		0%,
		50%,
		100% {
			opacity: 0.6;
		}

		25% {
			opacity: 1;
		}
	}
</style>
