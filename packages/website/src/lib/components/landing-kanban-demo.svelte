<script lang="ts">
import { GitBranch, ChatCircle, Lightning } from "phosphor-svelte";

import LandingDemoFrame from "./landing-demo-frame.svelte";
import { websiteThemeStore } from "$lib/theme/theme.js";

interface IllustrationCard {
	id: string;
	titleWidth: number;
	agent: "claude" | "codex" | "cursor" | "opencode";
	projectColor: string;
	insertions: number;
	deletions: number;
	accent?: "streaming" | "question" | "review" | "done" | null;
}

interface IllustrationColumn {
	id: string;
	label: string;
	color: string;
	count: number;
	cards: readonly IllustrationCard[];
}

const theme = $derived($websiteThemeStore);

function agentIcon(agent: IllustrationCard["agent"], t: string): string {
	if (agent === "codex") return `/svgs/agents/codex/codex-icon-${t}.svg`;
	if (agent === "cursor") return `/svgs/agents/cursor/cursor-icon-${t}.svg`;
	if (agent === "opencode") return `/svgs/agents/opencode/opencode-logo-${t}.svg`;
	return `/svgs/agents/claude/claude-icon-${t}.svg`;
}

const columns: readonly IllustrationColumn[] = [
	{
		id: "input",
		label: "Input needed",
		color: "#FFB020",
		count: 4,
		cards: [
			{
				id: "c1",
				titleWidth: 78,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 4,
				deletions: 0,
				accent: "question",
			},
			{
				id: "c1b",
				titleWidth: 64,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 2,
				deletions: 1,
				accent: "question",
			},
			{
				id: "c1c",
				titleWidth: 70,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 7,
				deletions: 0,
				accent: "question",
			},
			{
				id: "c1d",
				titleWidth: 82,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 3,
				deletions: 2,
				accent: "question",
			},
		],
	},
	{
		id: "planning",
		label: "Planning",
		color: "#4AD0FF",
		count: 5,
		cards: [
			{
				id: "c2",
				titleWidth: 82,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 11,
				deletions: 2,
				accent: "streaming",
			},
			{
				id: "c3",
				titleWidth: 70,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 8,
				deletions: 0,
				accent: "streaming",
			},
			{
				id: "c3b",
				titleWidth: 76,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 5,
				deletions: 0,
				accent: null,
			},
			{
				id: "c3c",
				titleWidth: 68,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 13,
				deletions: 4,
				accent: "streaming",
			},
			{
				id: "c3d",
				titleWidth: 80,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 9,
				deletions: 1,
				accent: null,
			},
		],
	},
	{
		id: "working",
		label: "Working",
		color: "#9858FF",
		count: 5,
		cards: [
			{
				id: "c4",
				titleWidth: 88,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 38,
				deletions: 9,
				accent: "streaming",
			},
			{
				id: "c5",
				titleWidth: 74,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 6,
				deletions: 1,
				accent: "streaming",
			},
			{
				id: "c5b",
				titleWidth: 80,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 17,
				deletions: 3,
				accent: "streaming",
			},
			{
				id: "c5c",
				titleWidth: 72,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 24,
				deletions: 8,
				accent: "streaming",
			},
			{
				id: "c5d",
				titleWidth: 84,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 12,
				deletions: 2,
				accent: "streaming",
			},
		],
	},
	{
		id: "review",
		label: "Needs Review",
		color: "#FF78F7",
		count: 5,
		cards: [
			{
				id: "c6",
				titleWidth: 84,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 52,
				deletions: 14,
				accent: "review",
			},
			{
				id: "c7",
				titleWidth: 68,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 29,
				deletions: 11,
				accent: "review",
			},
			{
				id: "c7b",
				titleWidth: 72,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 18,
				deletions: 6,
				accent: "review",
			},
			{
				id: "c7c",
				titleWidth: 78,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 41,
				deletions: 9,
				accent: "review",
			},
			{
				id: "c7d",
				titleWidth: 66,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 23,
				deletions: 5,
				accent: "review",
			},
		],
	},
	{
		id: "done",
		label: "Done",
		color: "#22C55E",
		count: 6,
		cards: [
			{
				id: "c8",
				titleWidth: 76,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 14,
				deletions: 4,
				accent: "done",
			},
			{
				id: "c9",
				titleWidth: 72,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 21,
				deletions: 5,
				accent: "done",
			},
			{
				id: "c9b",
				titleWidth: 68,
				agent: "claude",
				projectColor: "#9858FF",
				insertions: 9,
				deletions: 2,
				accent: "done",
			},
			{
				id: "c9c",
				titleWidth: 80,
				agent: "codex",
				projectColor: "#4AD0FF",
				insertions: 33,
				deletions: 7,
				accent: "done",
			},
			{
				id: "c9d",
				titleWidth: 74,
				agent: "cursor",
				projectColor: "#18D6C3",
				insertions: 16,
				deletions: 3,
				accent: "done",
			},
			{
				id: "c9e",
				titleWidth: 82,
				agent: "opencode",
				projectColor: "#FF8D20",
				insertions: 28,
				deletions: 6,
				accent: "done",
			},
		],
	},
];

interface Props {
	bare?: boolean;
}

let { bare = false }: Props = $props();
</script>

<LandingDemoFrame {bare}>
	{#snippet children()}
		<div class="kanban-illustration h-full w-full">
			<div class="board">
				{#each columns as column (column.id)}
					<div class="column">
						<div class="column-header">
							<span class="column-dot" style="background: {column.color};"></span>
							<span class="column-label">{column.label}</span>
							<span class="column-count">{column.count}</span>
						</div>
						<div class="column-body">
							{#each column.cards as card (card.id)}
								<div class="card">
									<div class="card-top">
										<div class="card-agent">
											<img src={agentIcon(card.agent, theme)} alt="" />
										</div>
										<span class="card-project-dot" style="background: {card.projectColor};"></span>
										<div class="card-spacer"></div>
										{#if card.accent === "streaming"}
											<span class="card-pulse"></span>
										{/if}
									</div>
									<div class="card-title-row">
										<div class="card-title-line" style="width: {card.titleWidth}%;"></div>
										<div class="card-title-line short" style="width: {Math.max(card.titleWidth - 30, 35)}%;"></div>
									</div>
									<div class="card-footer">
										<div class="card-diff">
											<span class="diff-add">+{card.insertions}</span>
											{#if card.deletions > 0}
												<span class="diff-del">−{card.deletions}</span>
											{/if}
										</div>
										{#if card.accent === "question"}
											<span class="card-chip chip-question">
												<ChatCircle class="size-4" weight="fill" />
												Answer
											</span>
										{:else if card.accent === "review"}
											<span class="card-chip chip-review">
												<GitBranch class="size-4" weight="fill" />
												PR
											</span>
										{:else if card.accent === "streaming"}
											<span class="card-chip chip-streaming">
												<Lightning class="size-4" weight="fill" />
												Live
											</span>
										{:else if card.accent === "done"}
											<span class="card-chip chip-done">✓</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/snippet}
</LandingDemoFrame>

<style>
	.kanban-illustration {
		display: flex;
		padding: 1.75rem 1.5rem 0;
		background:
			radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--foreground) 4%, transparent) 0%, transparent 60%),
			var(--background);
	}

	.board {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 1.25rem;
		width: 100%;
		height: 100%;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
		padding: 1rem 0.875rem 1.25rem;
		border-radius: 1.125rem;
		background: color-mix(in srgb, var(--foreground) 3%, transparent);
		border: 1px solid color-mix(in srgb, var(--foreground) 6%, transparent);
		overflow: hidden;
	}

	.column-header {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.25rem 0.125rem 0.5rem;
		border-bottom: 1px dashed color-mix(in srgb, var(--foreground) 10%, transparent);
	}

	.column-dot {
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 999px;
		box-shadow: 0 0 14px currentColor;
		flex-shrink: 0;
	}

	.column-label {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--foreground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.column-count {
		margin-left: auto;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--muted-foreground);
		padding: 0.125rem 0.625rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
	}

	.column-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		flex: 1;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem 1rem 1rem;
		border-radius: 0.875rem;
		background: var(--background);
		border: 1px solid color-mix(in srgb, var(--foreground) 9%, transparent);
		box-shadow: 0 2px 0 color-mix(in srgb, var(--foreground) 4%, transparent);
		flex-shrink: 0;
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.card-agent {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
		flex-shrink: 0;
	}

	.card-agent img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.card-project-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.card-spacer {
		flex: 1;
	}

	.card-pulse {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
		background: #22C55E;
		box-shadow: 0 0 10px #22C55E;
		animation: pulse 1.6s ease-in-out infinite;
	}

	.card-title-row {
		display: flex;
		flex-direction: column;
		gap: 0.4375rem;
	}

	.card-title-line {
		height: 0.625rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--foreground) 22%, transparent);
	}

	.card-title-line.short {
		background: color-mix(in srgb, var(--foreground) 12%, transparent);
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.card-diff {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.diff-add {
		color: #22C55E;
	}

	.diff-del {
		color: #FF5D5A;
	}

	.card-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1875rem 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
		border-radius: 999px;
		line-height: 1;
	}

	.chip-question {
		color: #FFB020;
		background: color-mix(in srgb, #FFB020 16%, transparent);
	}

	.chip-review {
		color: #FF78F7;
		background: color-mix(in srgb, #FF78F7 16%, transparent);
	}

	.chip-streaming {
		color: #4AD0FF;
		background: color-mix(in srgb, #4AD0FF 16%, transparent);
	}

	.chip-done {
		color: #22C55E;
		background: color-mix(in srgb, #22C55E 16%, transparent);
		padding: 0.1875rem 0.625rem;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.55;
			transform: scale(0.85);
		}
	}
</style>
