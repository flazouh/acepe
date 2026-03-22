<script lang="ts">
import IconBrandGoogle from "@tabler/icons-svelte/icons/brand-google";
import { Button } from "$lib/components/ui/button/index.js";
</script>

<div class="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
	<div class="flex flex-col space-y-2 text-center">
		<h1 class="text-2xl font-semibold tracking-tight">Welcome back</h1>
		<p class="text-sm text-muted-foreground">Sign in to your account to continue</p>
	</div>

	<div class="grid gap-6">
		<Button
			variant="outline"
			class="rounded-full h-12 text-base font-medium"
			onclick={() => {
				// Handle Google Sign In
				console.log("Google Sign In clicked");
			}}
		>
			<IconBrandGoogle class="mr-2 size-5" />
			Sign in with Google
		</Button>
	</div>

	<p class="px-8 text-center text-sm text-muted-foreground">
		By clicking continue, you agree to our
		<a href="/terms" class="underline underline-offset-4 hover:text-primary"> Terms of Service </a>
		and
		<a href="/privacy" class="underline underline-offset-4 hover:text-primary"> Privacy Policy </a>.
	</p>
</div>
