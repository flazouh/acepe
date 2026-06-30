<script lang="ts">
import { CaretDown } from "phosphor-svelte";

interface AnimatedChevronProps {
	/**
	 * Whether the chevron should be in the open (rotated) state.
	 * When true, the chevron rotates 180 degrees to point upward.
	 * When false, the chevron points downward.
	 */
	isOpen?: boolean;

	/**
	 * Additional CSS classes to apply to the chevron icon.
	 * @default ""
	 */
	class?: string;

	/**
	 * Animation duration class from Tailwind.
	 * @default "duration-200"
	 */
	durationClass?: string;
}

let {
	isOpen = false,
	class: className = "",
	durationClass = "duration-200",
}: AnimatedChevronProps = $props();
</script>

<CaretDown size={12} weight="regular" class="size-3 shrink-0 {className} transition-transform {durationClass} {isOpen ? 'rotate-180' : ''}"
/>
