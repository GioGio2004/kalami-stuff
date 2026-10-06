import { diagramConnectors, diagramWidths, placeDiagram, type DiagramEdge, type DiagramLayout } from "@/lib/presentation";

/**
 * Lays a diagram slide out in the DOM: measures the area and the nodes, then
 * writes each node's width and place, the arrows' paths and the labels'
 * places straight onto the elements (never through React state, so it can't
 * race the animation that's drawing them). The geometry is pure
 * (lib/presentation/geometry.ts); this only measures and writes.
 *
 * Called by the slide on mount and resize, and by the choreography right
 * before it measures the arrows it draws.
 *
 * This folder is copied into the student app by scripts/sync-student.mjs; edit it here.
 */
export function layoutDiagram(area: HTMLElement): void {
  const layout = area.dataset.layout as DiagramLayout | undefined;
  const width = area.clientWidth;
  const height = area.clientHeight;
  if (!layout || width < 20 || height < 20) return;

  const nodes = Array.from(area.querySelectorAll<HTMLElement>(":scope > [data-node]"));
  const groups = Array.from(area.querySelectorAll<SVGGElement>("[data-edge]"));
  const labels = Array.from(area.querySelectorAll<HTMLElement>(":scope > [data-edge-label]"));
  const svg = area.querySelector<SVGSVGElement>(":scope > svg");
  if (nodes.length === 0) return;

  const unit = Math.min(width, height) / 100;
  const widest = labels.reduce((max, label) => Math.max(max, label.offsetWidth), 0);
  // An arrow needs room for its label (labels sit on the line) and a little air.
  const gap = Math.max(width * 0.065, widest + unit * 4, unit * 7);

  const widths = diagramWidths(layout, nodes.length, width, height, gap);
  nodes.forEach((node, i) => {
    node.style.width = `${widths[i]}px`;
  });
  const sizes = nodes.map((node) => ({ w: node.offsetWidth, h: node.offsetHeight }));
  const boxes = placeDiagram(layout, width, height, sizes, gap);
  nodes.forEach((node, i) => {
    node.style.left = `${boxes[i].x}px`;
    node.style.top = `${boxes[i].y}px`;
  });

  const edges: DiagramEdge[] = groups.map((group) => ({ from: Number(group.dataset.from), to: Number(group.dataset.to) }));
  const connectors = diagramConnectors(layout, boxes, edges, width, height, unit);
  if (svg) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  groups.forEach((group, i) => {
    group.querySelector("[data-k='edgeLine']")?.setAttribute("d", connectors[i].d);
    group.querySelector("[data-k='edgeHead']")?.setAttribute("d", connectors[i].head);
  });
  labels.forEach((label) => {
    const c = connectors[Number(label.dataset.edgeLabel)];
    if (!c) return;
    const w = label.offsetWidth;
    const h = label.offsetHeight;
    // On a level arrow the label sits on the line; beside an upright one.
    const x = c.vertical ? c.mid.x + unit * 1.6 : c.mid.x - w / 2;
    label.style.left = `${x}px`;
    label.style.top = `${c.mid.y - h / 2}px`;
  });
}
