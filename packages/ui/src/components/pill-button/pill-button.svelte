<script lang="ts">
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	import { cn } from "../../lib/utils";

	interface BaseProps {
		class?: string;
		variant?: "primary" | "outline" | "ghost" | "soft" | "invert";
		size?: "xs" | "sm" | "md" | "default";
		disabled?: boolean;
		children?: Snippet;
		/** Icon rendered in a circle on the right (hero CTA style) */
		trailingIcon?: Snippet;
		/** Extra class for the trailing icon circle */
		trailingCircleClass?: string;
	}

	type Props = BaseProps &
		(
			| (HTMLButtonAttributes & { href?: never })
			| (HTMLAnchorAttributes & { href: string })
		);

	let {
		class: className,
		variant = "primary",
		size = "default",
		children,
		trailingIcon,
		trailingCircleClass,
		disabled,
		href,
		...restProps
	}: Props = $props();

	const variantClasses = {
		primary: "bg-white text-black hover:bg-muted hover:text-foreground",
		outline: "border border-border bg-background text-foreground hover:bg-muted",
		ghost: "text-muted-foreground hover:text-foreground",
		soft: "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
		invert: "bg-[#141413] text-background hover:bg-[#333332] dark:bg-foreground dark:hover:bg-foreground/80",
	};

	const sizeClasses = {
		xs: "h-4 px-1.5 text-[10px] gap-0.5",
		sm: "h-6 px-2 text-xs gap-1",
		md: "h-7 pl-2.5 pr-1.5 text-xs gap-1.5",
		default: "pl-4 pr-2 py-2 text-sm gap-2",
	};

	/** Circle wrapper for trailing icon - equal gap above, below, left, right */
	const trailingCircleClasses = {
		xs: "flex h-3 w-3 shrink-0 items-center justify-center rounded-full",
		sm: "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
		md: "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
		default: "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
	};

	/** Circle background: default + hover (inverts with button on primary, like website hero CTA) */
	const trailingCircleBgClasses = {
		primary: "bg-black/10 group-hover:bg-white/10",
		outline: "bg-muted/60 group-hover:bg-muted/80",
		ghost: "bg-muted/40 group-hover:bg-muted/60",
		soft: "bg-foreground/15 group-hover:bg-foreground/25",
		invert: "bg-background/10 group-hover:bg-background/15",
	};

	const baseClasses = $derived(
		cn(
			"group inline-flex cursor-pointer items-center justify-center rounded-full font-medium",
			"transition-colors duration-200",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			"disabled:pointer-events-none disabled:opacity-50",
			"active:scale-[0.98]",
			variantClasses[variant],
			sizeClasses[size],
			className
		)
	);

	const trailingSpanClasses = $derived(
		cn(trailingCircleClasses[size], trailingCircleBgClasses[variant], trailingCircleClass)
	);
</script>

{#if href}
	<a
		{href}
		class={baseClasses}
		aria-disabled={disabled}
		{...restProps as HTMLAnchorAttributes}
	>
		{#if children}
			{@render children()}
		{/if}
		{#if trailingIcon}
			<span class={trailingSpanClasses}>{@render trailingIcon()}</span>
		{/if}
	</a>
{:else}
	<button
		class={baseClasses}
		type="button"
		{disabled}
		{...restProps as Omit<HTMLButtonAttributes, "type">}
	>
		{#if children}
			{@render children()}
		{/if}
		{#if trailingIcon}
			<span class={trailingSpanClasses}>{@render trailingIcon()}</span>
		{/if}
	</button>
{/if}
