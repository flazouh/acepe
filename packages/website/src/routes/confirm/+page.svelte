<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import logo from '$lib/assets/logo.svg';

	let redirectCountdown = $state(5);

	$effect(() => {
		const interval = setInterval(() => {
			redirectCountdown -= 1;
			if (redirectCountdown <= 0) {
				window.location.href = '/';
			}
		}, 1000);

		return () => clearInterval(interval);
	});
</script>

<div class="flex min-h-screen items-center justify-center px-6">
	<div class="text-center">
		<div class="mb-6 flex justify-center">
			<div
				class="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-green-600"
			>
				<svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 13l4 4L19 7"
					/>
				</svg>
			</div>
		</div>

		<h1 class="mb-2 text-3xl font-bold text-foreground md:text-4xl">{m.confirm_success_title()}</h1>
		<p class="mb-6 text-lg text-muted-foreground">{m.confirm_success_description()}</p>

		<div class="mt-8">
			<a
				href="/"
				class="theme-invert-btn inline-flex h-11 items-center justify-center rounded-lg px-6 font-medium transition-colors"
			>
				{m.back_to_home()}
			</a>
		</div>

		<p class="mt-8 text-sm text-muted-foreground">
			Redirecting in {redirectCountdown} seconds...
		</p>
	</div>
</div>
