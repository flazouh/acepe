<script lang="ts">
interface Props {
	attachment?: "standalone" | "tool-call";
}

let { attachment = "standalone" }: Props = $props();
</script>

<div class="permission-attached-card" data-testid="permission-bar-stub" data-attachment={attachment}>
	<button>Deny</button>
	<button>Always</button>
	<button>Allow</button>
</div>
