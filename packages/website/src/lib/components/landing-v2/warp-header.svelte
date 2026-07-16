<script lang="ts">
import { page } from "$app/stores";
import { BrandLockup, HugeiconsIcon } from "@acepe/ui";
import ThemePicker from "$lib/components/theme-picker.svelte";

interface Props {
	announcement?: string;
}

let { announcement = "Now available — orchestrate Claude Code, Codex, Cursor & OpenCode" }: Props =
	$props();

let barDismissed = $state(false);

const githubStars = $derived($page.data.githubStars as number | null);

function formatStars(count: number): string {
	if (count >= 1000) {
		return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	}
	return count.toString();
}

const navLinkClass =
	"text-[14px] text-foreground/70 transition-colors hover:text-foreground";
</script>

<div class="sticky top-0 z-50">
	{#if !barDismissed}
		<div
			class="relative flex h-9 items-center justify-center gap-2 bg-background px-10 text-center"
		>
			<span class="text-[13px] text-foreground/80">{announcement}</span>
			<a href="/download" class="text-[13px] font-medium text-foreground underline-offset-2 hover:underline">
				{"Learn more"}
			</a>
			<button
				type="button"
				onclick={() => (barDismissed = true)}
				class="absolute right-3 flex h-6 w-6 items-center justify-center text-foreground/40 transition-colors hover:text-foreground"
				aria-label="Dismiss announcement"
			>
				<HugeiconsIcon name="close" class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}

	<header class="border-b border-border/40 bg-background/80 backdrop-blur-xl">
		<div class="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6">
			<div class="flex items-center gap-10">
				<a href="/" class="flex items-center gap-2.5" aria-label="Acepe home">
					<BrandLockup wordmarkClass="text-[20px] text-foreground" />
				</a>
				<nav class="hidden items-center gap-7 md:flex">
					<a href="/blog" class={navLinkClass}>{"Product"}</a>
					<a href="/compare" class={navLinkClass}>{"Compare"}</a>
					<a href="/pricing" class={navLinkClass}>{"Pricing"}</a>
				</nav>
			</div>

			<div class="flex items-center gap-3 sm:gap-4">
				<a
					href="https://github.com/flazouh/acepe"
					target="_blank"
					rel="noopener noreferrer"
					class="hidden items-center gap-1.5 text-[14px] text-foreground/70 transition-colors hover:text-foreground sm:flex"
					aria-label="GitHub"
				>
					<HugeiconsIcon name="github" class="h-4 w-4" />
					{#if githubStars}
						<HugeiconsIcon name="star" class="h-3 w-3 text-foreground/50" />
						<span class="font-mono text-[13px]">{formatStars(githubStars)}</span>
					{/if}
				</a>
				<a href="/pricing" class="hidden text-[14px] text-foreground/70 transition-colors hover:text-foreground md:block">
					{"Contact sales"}
				</a>
				<ThemePicker />
				<a
					href="/download"
					class="inline-flex h-8 items-center rounded-[2px] bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-90"
				>
					{"Download"}
				</a>
			</div>
		</div>
	</header>
</div>
