<script lang="ts">
import { AgentToolCard } from "@acepe/ui/agent-panel";
import IconAdjustments from "@tabler/icons-svelte/icons/adjustments";
import IconArrowRight from "@tabler/icons-svelte/icons/arrow-right";
import IconTerminal from "@tabler/icons-svelte/icons/terminal";

import type { CommandOutput } from "../../utils/command-output-parser.js";

let { output }: { output: CommandOutput } = $props();

// Friendly model name mapping
const MODEL_NAMES: Record<string, string> = {
	opus: "Opus 4.5",
	sonnet: "Sonnet 4.5",
	haiku: "Haiku 4.5",
};

// Parse model info from stdout - detect model switch from stdout content itself
// Format 1: "Set model to Default (Opus 4.5 · Most capable for complex work)"
// Format 2: "Set model to sonnet (claude-sonnet-4-5-20250929)"
const modelInfo = $derived.by(() => {
	// Strip ANSI escape codes (ESC character + bracket + digits + m)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code pattern intentionally uses control character
	const stripped = output.stdout.replace(/\x1b\[\d+m/g, "").trim();

	// Try to extract model name from "Set model to X (description)"
	const match = stripped.match(/Set model to\s+(\w+)\s*\(([^)]+)\)/i);
	if (match) {
		return {
			name: match[1], // e.g., "Default" or "sonnet"
			description: match[2], // e.g., "Opus 4.5 · Most capable..." or "claude-sonnet-4-5-..."
		};
	}

	// Fallback: try simpler pattern
	const simpleMatch = stripped.match(/Set model to\s+(.+)/i);
	if (simpleMatch) {
		return {
			name: simpleMatch[1].trim(),
			description: null,
		};
	}

	return null;
});

// Check if this is a model switch command (from command name OR stdout content)
const isModelCommand = $derived(
	output.command === "/model" || output.message === "model" || modelInfo !== null
);

// Get a display-friendly model name and description
const displayModel = $derived.by(() => {
	if (!modelInfo) {
		return { name: null, description: null };
	}

	const nameLower = modelInfo.name.toLowerCase();

	// Case 1: Direct model name like "opus", "sonnet", "haiku"
	if (MODEL_NAMES[nameLower]) {
		// Description might be model ID like "claude-sonnet-4-5-20250929" - don't show it
		const isModelId = modelInfo.description?.startsWith("claude-");
		return {
			name: MODEL_NAMES[nameLower],
			description: isModelId ? null : modelInfo.description,
		};
	}

	// Case 2: "Default" with description containing model info
	if (nameLower === "default" && modelInfo.description) {
		// Extract friendly name from description like "Opus 4.5 · Most capable..."
		const versionMatch = modelInfo.description.match(
			/(Opus \d+(?:\.\d+)?|Sonnet \d+(?:\.\d+)?|Haiku \d+(?:\.\d+)?)/i
		);
		if (versionMatch) {
			// Extract the part after " · " as the description
			const descParts = modelInfo.description.split(" · ");
			const desc = descParts.length > 1 ? descParts.slice(1).join(" · ") : null;
			return {
				name: versionMatch[1],
				description: desc,
			};
		}
	}

	// Fallback: use raw name, check if description is just a model ID
	const isModelId = modelInfo.description?.startsWith("claude-");
	return {
		name: modelInfo.name,
		description: isModelId ? null : modelInfo.description,
	};
});
</script>

<AgentToolCard>
	{#if isModelCommand && modelInfo}
		<!-- Model switch display -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconAdjustments class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground">Model</span>
			<IconArrowRight class="h-3 w-3 text-muted-foreground/50 shrink-0" />
			<span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
				{displayModel.name}
			</span>
			{#if displayModel.description}
				<span class="text-muted-foreground/60 text-[10px] truncate">
					{displayModel.description}
				</span>
			{/if}
		</div>
	{:else if output.command}
		<!-- Header only - command without stdout yet -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="font-mono text-muted-foreground">{output.command}</span>
			{#if output.stdout}
				<span class="text-muted-foreground/70 truncate">
					{output.stdout}
				</span>
			{/if}
		</div>
	{:else if output.stdout}
		<!-- Stdout only - generic output display -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground/70 truncate">
				{output.stdout.replace(/\x1b\[\d+m/g, "")}
			</span>
		</div>
	{:else}
		<!-- Fallback - shouldn't happen but handle gracefully -->
		<div class="flex items-center gap-2 px-2 py-2 text-xs">
			<IconTerminal class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-muted-foreground/50 italic">Command output</span>
		</div>
	{/if}
</AgentToolCard>
