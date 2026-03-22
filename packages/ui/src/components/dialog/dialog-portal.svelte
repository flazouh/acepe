<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";

	let { children, ...restProps }: DialogPrimitive.PortalProps = $props();
</script>

<DialogPrimitive.Portal {...restProps}>
	{@render children?.()}
</DialogPrimitive.Portal>
