<script lang="ts">
import MainAppViewDemo from "$lib/components/main-app-view-demo.svelte";
</script>

<div class="main-app-showcase">
	<div class="main-app-showcase__scaled">
		<MainAppViewDemo />
	</div>
</div>

<style>
	.main-app-showcase {
		height: 34rem;
		overflow: hidden;
		border-radius: 1rem;
		pointer-events: none;
	}

	.main-app-showcase__scaled {
		width: 125%;
		margin-left: -12.5%;
		transform: scale(0.8);
		transform-origin: top center;
	}

	@media (max-width: 768px) {
		.main-app-showcase {
			height: 26rem;
		}

		.main-app-showcase__scaled {
			width: 166.666667%;
			margin-left: -33.333333%;
			transform: scale(0.6);
		}
	}
</style>
