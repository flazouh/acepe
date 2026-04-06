<script lang="ts">
import logo from "$lib/assets/favicon.svg";

let { class: className = "h-8 w-8" }: { class?: string } = $props();
</script>

<img src={logo} alt="" aria-hidden="true" class={className} />
