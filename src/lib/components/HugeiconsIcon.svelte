<script lang="ts" module>
  /** An icon from @hugeicons/core-free-icons: a list of [tag, attributes]. */
  export type IconSvg = readonly (readonly [
    string,
    Readonly<Record<string, string | number>>,
  ])[];

  // The icon data uses JSX-style names (strokeLinecap) and a React `key`;
  // SVG markup needs the attribute names (stroke-linecap).
  function svgAttributes(
    attributes: Readonly<Record<string, string | number>>,
    strokeWidth: number | undefined
  ): Record<string, string | number> {
    const result: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "key") continue;
      result[name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()] = value;
    }
    if (strokeWidth !== undefined) {
      result["stroke-width"] = strokeWidth;
      result.stroke = "currentColor";
    }
    return result;
  }
</script>

<script lang="ts">
  import type { SVGAttributes } from "svelte/elements";

  // Replaces @hugeicons/svelte's component, which renders an empty <svg> and
  // fills in the paths in onMount. That left every icon blank in the
  // server-rendered page until the JavaScript loaded. Drawing the paths in the
  // markup puts them in the first paint.
  interface Props extends SVGAttributes<SVGSVGElement> {
    icon: IconSvg;
    size?: string | number;
    /** Overrides the icon's own stroke width (1.5). */
    strokeWidth?: number;
    color?: string;
  }

  let {
    icon,
    size = 24,
    strokeWidth,
    color = "currentColor",
    class: className,
    ...restProps
  }: Props = $props();

  const children = $derived(
    icon.map(([tag, attributes]) => ({
      tag,
      attributes: svgAttributes(attributes, strokeWidth),
    }))
  );
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  {color}
  class={className}
  {...restProps}
>
  <!-- An icon never reorders its own shapes, so the index is a stable key. -->
  {#each children as child, index (index)}
    <svelte:element this={child.tag} {...child.attributes} />
  {/each}
</svg>
