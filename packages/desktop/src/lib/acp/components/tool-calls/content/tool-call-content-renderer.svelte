<script lang="ts">
import type { ToolCallContent } from "../../../schemas/tool-call-content.schema.js";

import ContentBlockRouter from "../../messages/content-block-router.svelte";
import DiffContentRenderer from "./diff-content-renderer.svelte";
import QuestionContentRenderer from "./question-content-renderer.svelte";
import SkillContentRenderer from "./skill-content-renderer.svelte";
import TaskContentRenderer from "./task-content-renderer.svelte";
import TerminalContentRenderer from "./terminal-content-renderer.svelte";
import TodoContentRenderer from "./todo-content-renderer.svelte";

interface Props {
	/**
	 * The content item to render.
	 */
	content: ToolCallContent;
	/**
	 * Whether the content is currently streaming.
	 */
	isStreaming?: boolean;
}

let { content, isStreaming = false }: Props = $props();
</script>

<!--
	ToolCallContentRenderer - Routes content to specialized renderers based on type.

	This component implements O(1) dispatch to the appropriate renderer using
	a simple switch on the discriminator field. Each content type gets its own
	optimized renderer component.
-->

{#if content.type === "content"}
	<!-- Wrapped ContentBlock - delegate to existing ContentBlockRouter -->
	<ContentBlockRouter block={content.content} {isStreaming} />
{:else if content.type === "diff"}
	<DiffContentRenderer {content} />
{:else if content.type === "terminal"}
	<TerminalContentRenderer {content} />
{:else if content.type === "question"}
	<QuestionContentRenderer {content} />
{:else if content.type === "todo"}
	<TodoContentRenderer {content} />
{:else if content.type === "skill"}
	<SkillContentRenderer {content} {isStreaming} />
{:else if content.type === "task"}
	<TaskContentRenderer {content} {isStreaming} />
{/if}
