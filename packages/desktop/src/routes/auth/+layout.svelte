<script lang="ts">
import { BrandLockup } from "@acepe/ui";
import { IconArrowLeft } from "@tabler/icons-svelte";
import AnimatedBackground from "$lib/components/animated-background.svelte";
import { Button } from "$lib/components/ui/button/index.js";
</script>

<main class="h-screen w-full overflow-hidden">
	<div class="grid h-full lg:grid-cols-2">
		<!-- Brand Side (Right on desktop) -->
		<div class="relative order-2 hidden h-full overflow-hidden lg:flex bg-[#1a1a1a]">
			<AnimatedBackground class="absolute inset-0" />
			<div class="absolute inset-0 z-10 flex flex-col justify-center px-12 text-white">
				<div class="flex max-w-lg flex-col gap-8">
					<BrandLockup
						class="mb-4 gap-3"
						markClass="h-10 w-10"
						wordmarkClass="text-2xl font-medium tracking-[0.14em] text-white"
					/>
					<div class="space-y-6">
						<h2 class="font-sans text-5xl leading-[1.1] tracking-[-1.5px] font-normal">
							The interface
							<br />
							for AI agents.
						</h2>
						<p class="max-w-md text-lg font-light leading-relaxed text-white/80">
							Connect to ACP-compatible agents through a single, modern interface. Build your
							personal library of intelligent conversations and insights.
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Content Side (Left on desktop) -->
		<div class="relative order-1 flex h-full items-center justify-center p-8 bg-background">
			<div class="absolute left-4 top-4 z-20 lg:left-6 lg:top-6">
				<Button href="/" size="icon" variant="ghost">
					<IconArrowLeft class="size-4" />
					<span class="sr-only">Go back to home</span>
				</Button>
			</div>
			<slot />
		</div>
	</div>
</main>
