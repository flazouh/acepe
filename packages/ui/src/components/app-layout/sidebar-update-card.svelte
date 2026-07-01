<script lang="ts">
import { RoundedIcon } from "../icons/index.js";
import type { SidebarUpdateKind } from "./types.js";

interface Props {
	/** Current updater stage driving the card's appearance. */
	kind: SidebarUpdateKind;
	/** Target version string (without leading `v`), or `null` when unknown. */
	version: string | null;
	/** Download/install progress, 0–100. Only used while downloading/installing. */
	percent?: number;
	/** Invoked on click for actionable states (install / retry). */
	onclick: () => void;
}

let { kind, version, percent = 0, onclick }: Props = $props();

const inProgress = $derived(kind === "downloading" || kind === "installing");

const title = $derived(
	kind === "downloading"
		? "Downloading update"
		: kind === "installing"
			? "Installing update"
			: kind === "error"
				? "Update failed"
				: "Update available",
);

const subtitle = $derived(
	kind === "downloading"
		? `${Math.round(percent)}%`
		: kind === "installing"
			? "Almost there…"
			: kind === "error"
				? "Click to retry"
				: version
					? `v${version}`
					: "A new version is ready",
);
</script>

<button
	type="button"
	class="group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors {kind ===
	'error'
		? 'border-destructive/40 bg-destructive/10 hover:bg-destructive/15'
		: 'border-border/60 bg-input/40 hover:border-border hover:bg-input/70'} {inProgress
		? 'cursor-default'
		: 'cursor-pointer'}"
	disabled={inProgress}
	title={kind === "available" && version ? `Download and install v${version}` : title}
	aria-label={title}
	{onclick}
>
	<span
		class="flex size-7 shrink-0 items-center justify-center rounded-md {kind === 'error'
			? 'bg-destructive/15 text-destructive'
			: 'bg-primary/10 text-primary'}"
	>
		{#if inProgress}
			<RoundedIcon name="spinner" class="size-4 animate-spin" />
		{:else if kind === "error"}
			<RoundedIcon name="alert" class="size-4" />
		{:else}
			<RoundedIcon name="download" class="size-4" />
		{/if}
	</span>

	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span class="truncate text-xs font-medium text-foreground">{title}</span>
		{#if kind === "downloading"}
			<span class="flex items-center gap-1.5">
				<span class="h-1 flex-1 overflow-hidden rounded-full bg-border/60">
					<span
						class="block h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
						style:width={`${Math.min(Math.max(percent, 0), 100)}%`}
					></span>
				</span>
				<span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">{subtitle}</span>
			</span>
		{:else}
			<span class="truncate text-[11px] text-muted-foreground">{subtitle}</span>
		{/if}
	</span>

	{#if kind === "available"}
		<RoundedIcon
			name="arrow-up-right"
			class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
		/>
	{:else if kind === "error"}
		<RoundedIcon
			name="refresh"
			class="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
		/>
	{/if}
</button>
