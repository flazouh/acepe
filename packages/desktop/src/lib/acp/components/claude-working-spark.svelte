<script lang="ts">
import {
	CLAUDE_WORKING_SPARK_DURATION_MS,
	CLAUDE_WORKING_SPARK_FRAME_COUNT,
	CLAUDE_WORKING_SPARK_SPRITE_SRC,
} from "./claude-working-spark-frames.js";

interface Props {
	class?: string;
	size?: number;
	label?: string;
}

let { class: className = "", size = 12, label = "Claude is working" }: Props = $props();
</script>

<!--
	Claude's real "working" spark, reproduced 1:1 from the Claude desktop app:
	an 84-frame vertical sprite (48x48/frame) used as a CSS mask and filled with
	`currentColor`, scrolled with `steps(84, jump-none)` over 5040ms so the spark
	morphs through its shapes. The outer box clips to a single frame; the inner
	sprite is `frames x` taller and translated upward one frame per step.
-->
<span
	class={`claude-working-spark ${className}`}
	style:--spark-size={`${size}px`}
	style:--spark-frames={CLAUDE_WORKING_SPARK_FRAME_COUNT}
	style:--spark-duration={`${CLAUDE_WORKING_SPARK_DURATION_MS}ms`}
	style:--spark-src={`url("${CLAUDE_WORKING_SPARK_SPRITE_SRC}")`}
	aria-label={label}
	role="img"
	data-claude-working-spark
>
	<span class="claude-working-spark__sprite" aria-hidden="true"></span>
</span>

<style>
	.claude-working-spark {
		display: inline-flex;
		width: var(--spark-size);
		height: var(--spark-size);
		overflow: hidden;
		flex-shrink: 0;
		/* Claude brand color; override `color` on the host to re-tint. */
		color: #d97757;
	}

	.claude-working-spark__sprite {
		width: 100%;
		height: calc(var(--spark-size) * var(--spark-frames));
		background-color: currentColor;
		-webkit-mask-image: var(--spark-src);
		mask-image: var(--spark-src);
		-webkit-mask-size: 100% 100%;
		mask-size: 100% 100%;
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		animation: claude-working-spark-spin var(--spark-duration)
			steps(var(--spark-frames), jump-none) infinite;
	}

	@keyframes claude-working-spark-spin {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(calc(-100% * (var(--spark-frames) - 1) / var(--spark-frames)));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.claude-working-spark__sprite {
			animation: none;
		}
	}
</style>
