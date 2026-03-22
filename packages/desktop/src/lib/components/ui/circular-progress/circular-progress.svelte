<script lang="ts">
interface Props {
	/** Current progress value */
	current: number;
	/** Total/max value */
	total: number;
	/** Size of the circle in pixels */
	size?: number;
	/** Stroke width in pixels */
	strokeWidth?: number;
	/** Additional CSS classes */
	class?: string;
}

let { current, total, size = 12, strokeWidth = 2, class: className = "" }: Props = $props();

const radius = $derived((size - strokeWidth) / 2);
const circumference = $derived(2 * Math.PI * radius);
const percentage = $derived(total > 0 ? Math.min(current / total, 1) : 0);
const strokeDashoffset = $derived(circumference * (1 - percentage));
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	class="circular-progress {className}"
	style="transform: rotate(-90deg)"
>
	<!-- Background circle -->
	<circle
		cx={size / 2}
		cy={size / 2}
		r={radius}
		fill="none"
		stroke="currentColor"
		stroke-width={strokeWidth}
		class="opacity-20"
	/>
	<!-- Progress circle -->
	<circle
		cx={size / 2}
		cy={size / 2}
		r={radius}
		fill="none"
		stroke="currentColor"
		stroke-width={strokeWidth}
		stroke-linecap="round"
		stroke-dasharray={circumference}
		stroke-dashoffset={strokeDashoffset}
		class="transition-[stroke-dashoffset] duration-300 ease-out"
	/>
</svg>
