<script lang="ts">
import { User } from "phosphor-svelte";
import { Avatar, AvatarFallback } from "$lib/components/ui/avatar/index.js";
</script>

<button type="button" class="cursor-pointer" aria-label={"User menu"}>
	<Avatar class="size-6">
		<AvatarFallback class="bg-muted">
			<User class="size-3.5 text-muted-foreground" />
		</AvatarFallback>
	</Avatar>
</button>
