<script lang="ts">
  import { Drawer as DrawerPrimitive } from "vaul-svelte";

  let {
    shouldScaleBackground = true,
    open = $bindable(false),
    activeSnapPoint = $bindable(null),
    children,
    ...restProps
  }: DrawerPrimitive.RootProps = $props();
</script>

<DrawerPrimitive.Root
  {shouldScaleBackground}
  bind:open
  bind:activeSnapPoint
  {...restProps}
>
  {@render children?.()}
</DrawerPrimitive.Root>
