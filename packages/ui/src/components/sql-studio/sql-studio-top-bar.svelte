<script lang="ts">
  import Database from "phosphor-svelte/lib/Database";
  import { cn } from "../../lib/utils.js";
  import {
    EmbeddedPanelHeader,
    HeaderTitleCell,
    HeaderActionCell,
    CloseAction,
  } from "../panel-header/index.js";

  interface Props {
    onClose: () => void;
    class?: string;
  }

  let { onClose, class: className }: Props = $props();
</script>

<EmbeddedPanelHeader class={className}>
  <HeaderTitleCell>
    <Database
      size={14}
      weight="fill"
      class="shrink-0 mr-1.5 text-muted-foreground"
    />
    <span
      class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none"
    >
      Database Manager
    </span>
  </HeaderTitleCell>
  <HeaderActionCell>
    <CloseAction {onClose} title="Close" />
  </HeaderActionCell>
</EmbeddedPanelHeader>
