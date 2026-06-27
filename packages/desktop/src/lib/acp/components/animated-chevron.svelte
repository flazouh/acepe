<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";

interface AnimatedChevronProps {
	/**
	 * Whether the chevron should be in the open (rotated) state.
	 * When true, the chevron rotates 180 degrees to point upward.
	 * When false, the chevron points downward.
	 */
	isOpen?: boolean;

	/**
	 * Additional CSS classes to apply to the chevron icon.
	 * @default "h-4 w-4"
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
	class: className = "h-4 w-4",
	durationClass = "duration-200",
}: AnimatedChevronProps = $props();
</script>

<ChevronDown
	class="{className} transition-transform {durationClass} {isOpen ? 'rotate-180' : ''}"
/>
