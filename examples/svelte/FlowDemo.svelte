<!-- Svelte 5: register the element in the browser only, then pass the doc as a property. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { FlowDoc, LodeFlowElement } from 'lodeflow';
  import initial from '../release-slip.json';

  let el: LodeFlowElement | undefined = $state();
  let doc = $state<FlowDoc>(initial as FlowDoc);

  onMount(async () => {
    await import('lodeflow'); // defines <lode-flow>; safe to skip during SSR
    if (el) el.doc = doc;
  });

  $effect(() => {
    if (el && customElements.get('lode-flow') && el.doc !== doc) el.doc = doc;
  });
</script>

<lode-flow
  bind:this={el}
  orientation="auto"
  storage-key="flow-demo"
  style="height: 480px; border-radius: 12px"
  onlode-change={(e: CustomEvent<{ doc: FlowDoc }>) => (doc = e.detail.doc)}
></lode-flow>

<!-- Svelte 4: use on:lode-change={(e) => (doc = e.detail.doc)} instead of onlode-change. -->
