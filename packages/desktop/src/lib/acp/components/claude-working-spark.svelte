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
		<img
			src={frameSrc}
			alt=""
			class="claude-working-spark__frame"
			style:--frame-index={frameIndex}
			aria-hidden="true"
			width={size}
			height={size}
		/>
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

	.claude-working-spark__frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0;
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
