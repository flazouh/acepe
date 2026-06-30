<script lang="ts">
interface Props {
	title: string;
	description: string;
	/** Center the title/description in a max-width column to align with centered content. */
	centered?: boolean;
}

let { title, description, centered = false }: Props = $props();
</script>

<header class="shrink-0 px-6 pb-5 pt-3">
	<div class={centered ? "mx-auto max-w-3xl" : ""}>
		<h2 class="text-[22px] font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
		<p class="mt-1.5 max-w-2xl text-[13px] leading-snug text-muted-foreground">{description}</p>
	</div>
</header>
