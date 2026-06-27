<script lang="ts">
  import { cn } from "../../lib/utils";
  import { type ButtonProps, buttonVariants } from "./variants.js";

  let {
    class: className,
    variant = "default",
    size = "default",
    active = false,
    ref = $bindable(null),
    href,
    type = "button",
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    class={cn(buttonVariants({ variant, size, active }), className)}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? "link" : null}
    tabindex={disabled ? -1 : null}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    data-variant={variant}
    data-size={size}
    class={cn(buttonVariants({ variant, size, active }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
