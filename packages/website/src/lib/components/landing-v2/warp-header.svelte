<script lang="ts">
import { page } from "$app/stores";
import AcepeMark from "./acepe-mark.svelte";
import { X } from "@lucide/svelte";
import { GithubLogo, Star } from "phosphor-svelte";

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
	"text-[14px] text-[#f8f5ee]/70 transition-colors hover:text-[#f8f5ee]";
</script>

<div class="sticky top-0 z-50">
	{#if !barDismissed}
		<div
			class="relative flex h-9 items-center justify-center gap-2 bg-[#0d0d0d] px-10 text-center"
		>
			<span class="text-[13px] text-[#f8f5ee]/80">{announcement}</span>
			<a href="/download" class="text-[13px] font-medium text-[#f8f5ee] underline-offset-2 hover:underline">
				{"Learn more"}
			</a>
			<button
				type="button"
				onclick={() => (barDismissed = true)}
				class="absolute right-3 flex h-6 w-6 items-center justify-center text-[#f8f5ee]/40 transition-colors hover:text-[#f8f5ee]"
				aria-label="Dismiss announcement"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}

	<header class="bg-[#121212]/80 backdrop-blur-xl">
		<div class="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6">
			<div class="flex items-center gap-10">
				<a href="/" class="flex items-center gap-2.5" aria-label="Acepe home">
					<AcepeMark class="h-6 w-6" />
					<span class="text-[15px] font-semibold tracking-[0.02em] text-[#f8f5ee]">Acepe</span>
				</a>
				<nav class="hidden items-center gap-7 md:flex">
					<a href="/blog" class={navLinkClass}>{"Product"}</a>
					<a href="/compare" class={navLinkClass}>{"Compare"}</a>
					<a href="/pricing" class={navLinkClass}>{"Pricing"}</a>
				</nav>
			</div>

			<div class="flex items-center gap-5">
				<a
					href="https://github.com/flazouh/acepe"
					target="_blank"
					rel="noopener noreferrer"
					class="hidden items-center gap-1.5 text-[14px] text-[#f8f5ee]/70 transition-colors hover:text-[#f8f5ee] sm:flex"
					aria-label="GitHub"
				>
					<GithubLogo class="h-4 w-4" weight="fill" />
					{#if githubStars}
						<Star class="h-3 w-3 text-amber-400" weight="fill" />
						<span class="font-mono text-[13px]">{formatStars(githubStars)}</span>
					{/if}
				</a>
				<a href="/pricing" class="hidden text-[14px] text-[#f8f5ee]/70 transition-colors hover:text-[#f8f5ee] md:block">
					{"Contact sales"}
				</a>
				<a
					href="/download"
					class="inline-flex h-8 items-center rounded-[2px] bg-[#f8f5ee] px-4 text-[14px] font-medium text-[#121212] transition-opacity hover:opacity-90"
				>
					{"Download"}
				</a>
			</div>
		</div>
	</header>
</div>
