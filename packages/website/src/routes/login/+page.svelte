<script lang="ts">
import { BrandLockup } from "@acepe/ui";
import AgentIconsRow from "$lib/components/agent-icons-row.svelte";
import AnimatedBackground from "$lib/components/animated-background.svelte";
</script>

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
			<svg class="h-5 w-5" viewBox="0 0 24 24">
				<path
					fill="#4285F4"
					d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
				/>
				<path
					fill="#34A853"
					d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				/>
				<path
					fill="#FBBC05"
					d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				/>
				<path
					fill="#EA4335"
					d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				/>
			</svg>
			{"Sign in with Google"}
		</a>

		<!-- Agent Icons -->
		<AgentIconsRow size={20} class="gap-3" />
	</div>
</div>
