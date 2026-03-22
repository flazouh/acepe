<script lang="ts">
  import { Drawer as DrawerPrimitive } from "vaul-svelte";

  let { children, ...restProps }: DrawerPrimitive.PortalProps = $props();
</script>

<DrawerPrimitive.Portal {...restProps}>
  {@render children?.()}
</DrawerPrimitive.Portal>
