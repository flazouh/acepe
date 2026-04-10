<script lang="ts">
/**
 * PageHero - Reusable header and subheader for inner pages (blog, features, changelog).
 * Same layout on all pages: section with px-6 pt-24 pb-16, max-w-6xl, left-aligned.
 */
interface Props {
	title: string;
	subtitle: string;
}

let { title, subtitle }: Props = $props();
</script>

<section class="px-6 pt-24 pb-16">
	<div class="mx-auto flex max-w-6xl flex-col text-left">
		<h1 class="text-5xl font-bold tracking-tight sm:text-6xl">{title}</h1>
		<p class="mt-6 text-lg text-muted-foreground">{subtitle}</p>
	</div>
</section>
