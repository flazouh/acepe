<script lang="ts">
import { CLAUDE_WORKING_SPARK_FRAME_SRCS } from "./claude-working-spark-frames.js";

interface Props {
	class?: string;
	size?: number;
	label?: string;
}

let { class: className = "", size = 12, label = "Claude is working" }: Props = $props();
</script>

<span
	class={`claude-working-spark ${className}`}
	style:--spark-size={`${size}px`}
	aria-label={label}
	role="img"
	data-claude-working-spark
>
	{#each CLAUDE_WORKING_SPARK_FRAME_SRCS as frameSrc, frameIndex (frameSrc)}
		<span
			class="claude-working-spark__frame"
			style:--frame-index={frameIndex}
			style:--frame-src={`url("${frameSrc}")`}
			aria-hidden="true"
		></span>
	{/each}
</span>

<style>
	.claude-working-spark {
		position: relative;
		display: inline-flex;
		width: var(--spark-size);
		height: var(--spark-size);
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: #d97757;
	}

	/*
	 * The upstream frames are black-pixel alpha masks (RGB 0,0,0 + alpha shape),
	 * so rendering them as <img> would paint the spark black regardless of the
	 * container `color`. Use them as CSS masks instead and fill with `currentColor`
	 * so the spark renders in the Claude brand color (#d97757) and can be re-tinted
	 * by overriding `color` on the host element.
	 */
	.claude-working-spark__frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background-color: currentColor;
		opacity: 0;
		-webkit-mask-image: var(--frame-src);
		mask-image: var(--frame-src);
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		-webkit-mask-position: center;
		mask-position: center;
		-webkit-mask-size: contain;
		mask-size: contain;
		animation: claude-working-spark-frame 960ms steps(1, end) infinite;
		animation-delay: calc(var(--frame-index) * -120ms);
	}

	@keyframes claude-working-spark-frame {
		0%,
		12.49% {
			opacity: 1;
		}

		12.5%,
		100% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.claude-working-spark__frame {
			animation: none;
			opacity: 0;
		}

		.claude-working-spark__frame:first-child {
			opacity: 1;
		}
	}
</style>
