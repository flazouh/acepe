<script lang="ts">
interface Props {
	active: "gradients" | "icons" | "readme-banner";
}

let { active }: Props = $props();

const linkClass =
	"rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function navClass(section: Props["active"]): string {
	return `${linkClass} ${active === section ? "bg-foreground text-background" : "text-muted-foreground hover:bg-card hover:text-foreground"}`;
}
</script>

<header class="border-b border-border/60 bg-background/90 backdrop-blur-xl">
	<div class="mx-auto flex max-w-[92rem] flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
		<a href="/design-system/gradients" class="group inline-flex items-center gap-3">
			<span class="grid size-8 place-items-center rounded-md border border-border bg-card text-xs font-semibold text-foreground">A</span>
			<span>
				<span class="block text-sm font-medium text-foreground">Acepe design system</span>
				<span class="block text-xs text-muted-foreground">Working visual language</span>
			</span>
		</a>

		<nav class="flex w-fit items-center gap-1 rounded-lg border border-border/60 bg-card/50 p-1" aria-label="Design system sections">
			<a
				href="/design-system/gradients"
				class={navClass("gradients")}
				aria-current={active === "gradients" ? "page" : undefined}
			>
				Gradients
			</a>
			<a
				href="/design-system/icons"
				class={navClass("icons")}
				aria-current={active === "icons" ? "page" : undefined}
			>
				Icons
			</a>
			<a
				href="/design-system/readme-banner"
				class={navClass("readme-banner")}
				aria-current={active === "readme-banner" ? "page" : undefined}
			>
				README banner
			</a>
		</nav>
	</div>
</header>
