<script lang="ts">
interface Props {
	title: string;
	description: string;
}

let { title, description }: Props = $props();
</script>

<header class="shrink-0 border-b border-border/50 px-6 py-4">
	<h2 class="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
	<p class="mt-1 max-w-2xl text-[13px] leading-snug text-muted-foreground">{description}</p>
</header>
