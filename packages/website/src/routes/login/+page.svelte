<script lang="ts">
import { BrandLockup, GoogleLogoIcon } from "@acepe/ui";
import AgentIconsRow from "$lib/components/agent-icons-row.svelte";
import AnimatedBackground from "$lib/components/animated-background.svelte";
import Seo from "$lib/components/seo/seo.svelte";
</script>

<Seo
	title="Sign in"
	description="Sign in to Acepe."
	noindex
/>

<div class="fixed inset-0 flex items-center justify-center">
	<!-- Full Screen Shader Background -->
	<div class="absolute inset-0">
		<AnimatedBackground />
	</div>

	<!-- Logo + Brand (top left corner) -->
	<a
		href="/"
		class="absolute top-6 left-6 z-20 flex items-center gap-3 transition-opacity hover:opacity-80"
	>
		<BrandLockup
			class="gap-3"
			markClass="h-7 w-7"
			wordmarkClass="text-lg text-foreground tracking-[0.16em]"
		/>
	</a>

	<!-- Content Card -->
	<div
		class="relative z-10 mx-4 flex w-full max-w-[420px] flex-col items-center justify-center rounded-2xl bg-background/80 p-8 backdrop-blur-md md:mx-0 md:p-10"
	>
		<!-- Welcome Message -->
		<h1 class="mb-2 text-center text-2xl font-bold text-foreground">{"Welcome back"}</h1>
		<p class="mb-8 max-w-sm text-center text-sm text-muted-foreground">
			{"Sign in to access the admin dashboard"}
		</p>

		<!-- Google Sign-in Button -->
		<a
			href="/auth/google"
			class="theme-invert-btn mb-8 flex h-11 items-center justify-center gap-3 rounded-lg px-6 font-medium transition-colors"
		>
			<GoogleLogoIcon class="h-5 w-5" />
			{"Sign in with Google"}
		</a>

		<!-- Agent Icons -->
		<AgentIconsRow size={20} class="gap-3" />
	</div>
</div>
