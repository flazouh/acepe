<script lang="ts">
	import ArrowUp from "phosphor-svelte/lib/ArrowUp";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import Cpu from "phosphor-svelte/lib/Cpu";

	import { Colors } from "../../lib/colors.js";
	import { InputContainer } from "../input-container/index.js";
	import BuildIcon from "../icons/build-icon.svelte";
	import PlanIcon from "../icons/plan-icon.svelte";

	interface Props {
		/** Placeholder text shown in the content area */
		placeholder?: string;
		/** Mode label shown in the toolbar (e.g. "Build", "Plan") */
		mode?: "build" | "plan";
		/** Model label shown in the toolbar */
		model?: string;
	}

	let {
		placeholder = "Message Acepe…",
		mode = "build",
		model = "claude-sonnet-4-6",
	}: Props = $props();

	const buildColor = "var(--success)";
	const planColor = Colors.orange;
	const activeColor = $derived(mode === "plan" ? planColor : buildColor);
</script>

<div class="px-2 pb-2 pt-1 shrink-0">
	<InputContainer class="border border-border">
		<!-- Editor area: submit button embedded top-right -->
		<div class="relative min-w-0">
			<div class="absolute top-0 right-0 z-10">
				<button
					type="button"
					tabindex="-1"
					class="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-background cursor-default"
					style="background-color: {activeColor};"
					aria-label="Send"
				>
					<ArrowUp size={14} weight="bold" />
				</button>
			</div>
			<div class="min-h-[72px] flex items-start pr-12">
				<span class="text-sm leading-relaxed text-muted-foreground select-none">
					{placeholder}
				</span>
			</div>
		</div>
	</InputContainer>

	<!-- Toolbar: mode selector pill + model selector -->
	<div class="flex items-center gap-1 px-1 pt-1.5 select-none">
		<!-- Mode selector pill (matches mode-selector.svelte) -->
		<div class="flex h-7 items-center gap-0.5 rounded-full p-0.5">
			{#each [{ id: "plan", label: "Plan", color: planColor }, { id: "build", label: "Build", color: buildColor }] as m (m.id)}
				{@const selected = mode === m.id}
				<div
					class="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium
						{selected ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground'}"
				>
					{#if m.id === "plan"}
						<PlanIcon size="md" class={selected ? "text-[color:var(--color-orange,#FF8D20)]" : ""} />
					{:else}
						<BuildIcon size="md" class={selected ? "" : "opacity-60"} />
					{/if}
					<span>{m.label}</span>
				</div>
			{/each}
		</div>

		<!-- Model selector (matches model-selector.trigger.svelte) -->
		<div class="flex h-7 items-center gap-0.5 rounded-full p-0.5">
			<div class="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground">
				<Cpu class="text-primary h-3.5 w-3.5 shrink-0" weight="fill" />
				<span>{model}</span>
				<CaretDown class="h-3.5 w-3.5 shrink-0" weight="bold" />
			</div>
		</div>
	</div>
</div>
