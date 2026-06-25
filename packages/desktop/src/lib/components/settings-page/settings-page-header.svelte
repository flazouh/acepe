<script lang="ts">
interface Props {
	title: string;
	description: string;
}

let { title, description }: Props = $props();
</script>

<header class="shrink-0 border-b border-border/40 px-3 py-2">
	<h2 class="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
	<p class="mt-0.5 max-w-2xl text-[11px] leading-snug text-muted-foreground/70">{description}</p>
</header>
