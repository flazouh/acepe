<script lang="ts">
	import type { PrChecksItem } from "./types.js";

	interface Props {
		checks?: readonly PrChecksItem[];
		isLoading?: boolean;
		hasResolved?: boolean;
		size?: "sm" | "md";
		class?: string;
	}

	let {
		checks = [],
		isLoading = false,
		hasResolved = false,
		size = "sm",
		class: className = "",
	}: Props = $props();

	const hasActiveChecks = $derived(checks.some((check) => check.status !== "COMPLETED"));
	const hasFailure = $derived(
		checks.some(
			(check) =>
				check.status === "COMPLETED" &&
				(check.conclusion === "FAILURE" ||
					check.conclusion === "TIMED_OUT" ||
					check.conclusion === "ACTION_REQUIRED" ||
					check.conclusion === "STARTUP_FAILURE")
		)
	);
	const hasNeutral = $derived(
		checks.some(
			(check) =>
				check.status === "COMPLETED" &&
				(check.conclusion === "NEUTRAL" ||
					check.conclusion === "CANCELLED" ||
					check.conclusion === "SKIPPED" ||
					check.conclusion === "STALE" ||
					check.conclusion === "UNKNOWN")
		)
	);
	const isWaitingForCi = $derived(hasResolved && checks.length === 0);
	const tone = $derived.by(() => {
		if (!hasResolved || isLoading || hasActiveChecks || isWaitingForCi) {
			return "loading";
		}
		if (hasFailure) {
			return "failure";
		}
		if (hasNeutral) {
			return "neutral";
		}
		return "success";
	});
	const srLabel = $derived.by(() => {
		if (isWaitingForCi) {
			return "Waiting for CI to start";
		}
		if (!hasResolved) {
			return "Checking CI status";
		}
		if (tone === "loading") {
			return "CI checks are running";
		}
		if (tone === "failure") {
			return "CI checks failed";
		}
		if (tone === "neutral") {
			return "CI checks completed with neutral status";
		}
		return "CI checks passed";
	});
	const sizeClass = $derived(size === "md" ? "h-3.5 w-3.5" : "h-2.5 w-2.5");
	const toneClass = $derived.by(() => {
		if (tone === "loading") {
			return "border-border/70 bg-muted/40";
		}
		if (tone === "failure") {
			return "border-red-500/50 bg-red-500";
		}
		if (tone === "neutral") {
			return "border-amber-500/50 bg-amber-400";
		}
		return "border-emerald-500/50 bg-emerald-500";
	});
</script>

<span
	class={`relative inline-flex shrink-0 items-center justify-center rounded-full border ${sizeClass} ${toneClass} ${className}`}
	title={srLabel}
	aria-label={srLabel}
>
	{#if tone === "loading"}
		<span class="absolute inset-[1px] rounded-full bg-foreground/55 animate-pulse"></span>
	{/if}
	<span class="sr-only">{srLabel}</span>
</span>
