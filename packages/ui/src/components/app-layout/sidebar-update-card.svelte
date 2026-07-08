<script lang="ts">
import { cn } from "../../lib/utils.js";
import { Button } from "../button/index.js";
import { RoundedIcon, type RoundedIconName } from "../icons/index.js";
import TextShimmer from "../text-shimmer/text-shimmer.svelte";
import {
	DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	getSidebarUpdateCardCopy,
	getSidebarUpdateCardVariantDefinition,
	type SidebarUpdateCardVariant,
} from "./sidebar-update-card-variants.js";
import type { SidebarUpdateKind } from "./types.js";

interface Props {
	/** Visual variant from the sidebar update card design system. */
	variant?: SidebarUpdateCardVariant;
	/** Current updater stage driving the card's appearance. */
	kind: SidebarUpdateKind;
	/** Target version string (without leading `v`), or `null` when unknown. */
	version: string | null;
	/** Download/install progress, 0-100. Only used while downloading/installing. */
	percent?: number;
	/** Invoked on click for actionable states (install / retry). */
	onclick: () => void;
}

let {
	variant = DEFAULT_SIDEBAR_UPDATE_CARD_VARIANT,
	kind,
	version,
	percent = 0,
	onclick,
}: Props = $props();

const variantDef = $derived(getSidebarUpdateCardVariantDefinition(variant));
const inProgress = $derived(kind === "downloading" || kind === "installing");
const clampedPercent = $derived(Math.min(Math.max(percent, 0), 100));
const copy = $derived(
	getSidebarUpdateCardCopy({
		kind,
		version,
		percent: clampedPercent,
	}),
);

const shellClass = $derived(
	cn(
		"sidebar-update-card flex w-full flex-col gap-1.5 rounded-md px-2.5 py-2",
		variantDef.shellClass,
		inProgress ? "sidebar-update-card--busy" : undefined,
		kind === "error" ? "sidebar-update-card--error" : undefined,
	),
);

const iconClass = $derived(
	cn(
		"update-card-icon flex size-4 shrink-0 items-center justify-center",
		variantDef.iconClass,
	),
);

const leadingIconName = $derived<RoundedIconName>(kind === "error" ? "warning" : "download");

const installTitle = $derived(
	version ? `Download and install ${version}` : "Download and install",
);
</script>

<div
	class={shellClass}
	data-testid="sidebar-update-card"
	data-kind={kind}
	data-variant={variantDef.id}
>
	<div class="flex min-w-0 items-center gap-1.5" data-testid="sidebar-update-card-surface">
		<span class={iconClass} aria-hidden="true">
			<RoundedIcon name={leadingIconName} class="size-3" />
		</span>

		<div class="min-w-0 flex-1">
			{#if inProgress}
				<TextShimmer class="block min-w-0 truncate text-xs font-semibold text-[color:var(--update-card-text)]">
					{copy.title}
				</TextShimmer>
			{:else}
				<span class="block min-w-0 truncate text-xs font-semibold text-[color:var(--update-card-text)]">
					{copy.title}
				</span>
			{/if}
		</div>

		{#if kind === "available" || kind === "error"}
			<Button
				size="xs"
				class={variantDef.ctaClass}
				title={kind === "available" ? installTitle : copy.title}
				aria-label={kind === "available" ? installTitle : copy.title}
				{onclick}
			>
				{copy.ctaLabel}
				{#if kind === "error"}
					<RoundedIcon name="refresh" class="size-3" />
				{/if}
			</Button>
		{/if}
	</div>

	{#if inProgress}
		<div
			class="update-card-progress"
			data-testid="sidebar-update-card-progress"
			role="progressbar"
			aria-label={copy.progressLabel}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={clampedPercent}
		>
			<span
				class="update-card-progress-fill"
				data-testid="sidebar-update-card-progress-fill"
				style:width={`${clampedPercent}%`}
			></span>
		</div>
	{/if}
</div>

<style>
	.sidebar-update-card {
		--update-card-bg: color-mix(in srgb, var(--card) 56%, transparent);
		--update-card-bg-hover: color-mix(in srgb, var(--accent) 42%, transparent);
		--update-card-text: var(--foreground);
		--update-card-muted: var(--muted-foreground);
		--update-card-border: color-mix(in srgb, var(--border) 72%, transparent);
		--update-card-icon-text: var(--muted-foreground);
		--update-card-action-bg: color-mix(in srgb, var(--foreground) 6%, transparent);
		--update-card-action-border: color-mix(in srgb, var(--border) 82%, transparent);
		--update-card-action-text: var(--foreground);
		--update-card-progress-track: color-mix(in srgb, var(--border) 48%, transparent);
		--update-card-progress-fill: color-mix(in srgb, var(--foreground) 62%, transparent);
		border: 1px solid var(--update-card-border);
		background: var(--update-card-bg);
		color: var(--update-card-text);
		transition:
			background-color 140ms ease,
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.sidebar-update-card:hover {
		background: var(--update-card-bg-hover);
	}

	.sidebar-update-card--busy {
		--update-card-bg: color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.sidebar-update-card--error {
		--update-card-border: color-mix(in srgb, var(--destructive) 40%, var(--border));
		--update-card-icon-text: var(--destructive);
		--update-card-progress-fill: var(--destructive);
	}

	.update-card-icon {
		color: var(--update-card-icon-text);
	}

	.update-card-progress {
		height: 3px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--update-card-progress-track);
	}

	.update-card-progress-fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--update-card-progress-fill);
		transition: width 160ms ease;
	}
</style>
