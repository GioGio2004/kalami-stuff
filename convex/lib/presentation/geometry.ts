// Diagram layout for presentation slides, as pure geometry: which arrows a
// layout draws, how wide nodes are, where they sit, and the arrows' paths.
// The player measures the DOM and feeds the numbers through here
// (components/presentations/diagram.ts), so nobody ever positions a node.
//
// The student app keeps a copy of this folder (scripts/sync-student.mjs); edit it here.

import type { DiagramLayout, DiagramNode } from "./index";

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type DiagramEdge = { from: number; to: number; label?: string };

/**
 * The arrows a layout draws, in the order they appear: a flow and a stack go
 * node to node; a cycle also closes the loop (labelled by the first node's
 * `edge`); a hub joins the first node to every other one.
 */
export function diagramEdges(layout: DiagramLayout, nodes: readonly DiagramNode[]): DiagramEdge[] {
  const n = nodes.length;
  if (n < 2) return [];
  switch (layout) {
    case "hub":
      return nodes.slice(1).map((node, i) => ({ from: 0, to: i + 1, label: node.edge }));
    case "cycle":
      return nodes.map((_, i) => ({ from: i, to: (i + 1) % n, label: nodes[(i + 1) % n].edge }));
    default:
      return nodes.slice(1).map((node, i) => ({ from: i, to: i + 1, label: node.edge }));
  }
}

/** A wide area lays a flow out in a row; a tall one stacks it. */
export function isWide(width: number, height: number): boolean {
  return width / height >= 1.15;
}

/** A flow of six or more nodes snakes over two rows on a wide area. */
export function flowRows(n: number): number {
  return n >= 6 ? 2 : 1;
}

/** How wide each node is, before its height is known. `gap` is the room an arrow (and its label) needs. */
export function diagramWidths(layout: DiagramLayout, n: number, width: number, height: number, gap: number): number[] {
  const wide = isWide(width, height);
  const short = Math.min(width, height);
  const fill = (w: number) => Array.from({ length: n }, () => Math.max(48, w));
  switch (layout) {
    case "flow": {
      if (!wide) return fill(Math.min(width * 0.82, 560));
      const perRow = Math.ceil(n / flowRows(n));
      return fill(Math.min((width - gap * (perRow - 1)) / perRow, width * 0.3));
    }
    case "stack":
      return fill(wide ? Math.min(width * 0.62, height * 1.7) : width * 0.86);
    case "cycle":
      return fill(short * (n <= 4 ? 0.38 : n <= 6 ? 0.31 : 0.27) * (wide ? 1.2 : 1));
    case "hub": {
      const outer = short * (n <= 5 ? 0.31 : 0.26) * (wide ? 1.2 : 1);
      return [short * 0.36 * (wide ? 1.15 : 1), ...Array.from({ length: n - 1 }, () => outer)].map((w) => Math.max(48, w));
    }
  }
}

/** Where each node sits (its box), given every node's measured size. */
export function placeDiagram(
  layout: DiagramLayout,
  width: number,
  height: number,
  sizes: readonly { w: number; h: number }[],
  gap: number,
): Box[] {
  const n = sizes.length;
  const at = (i: number, cx: number, cy: number): Box => ({ x: cx - sizes[i].w / 2, y: cy - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h });
  const column = (): Box[] => {
    const total = sizes.reduce((sum, s) => sum + s.h, 0);
    const space = n > 1 ? Math.max(8, Math.min(gap, (height - total) / (n - 1))) : 0;
    let y = (height - (total + space * (n - 1))) / 2;
    return sizes.map((s, i) => {
      const box = at(i, width / 2, y + s.h / 2);
      y += s.h + space;
      return box;
    });
  };
  const maxW = Math.max(...sizes.map((s) => s.w));
  const maxH = Math.max(...sizes.map((s) => s.h));

  switch (layout) {
    case "flow": {
      if (!isWide(width, height)) return column();
      const rows = flowRows(n);
      const perRow = Math.ceil(n / rows);
      const rowWidth = maxW * perRow + gap * (perRow - 1);
      const x0 = (width - rowWidth) / 2;
      const columnX = (c: number) => x0 + c * (maxW + gap) + maxW / 2;
      if (rows === 1) return sizes.map((_, i) => at(i, columnX(i), height / 2));
      const rowGap = Math.max(height * 0.18, gap * 0.6);
      const cy1 = height / 2 - (maxH + rowGap) / 2;
      const cy2 = height / 2 + (maxH + rowGap) / 2;
      // The second row runs right to left, so the arrow turns down at the end of the first.
      return sizes.map((_, i) => (i < perRow ? at(i, columnX(i), cy1) : at(i, columnX(perRow - 1 - (i - perRow)), cy2)));
    }
    case "stack":
      return column();
    case "cycle": {
      const rx = Math.max(0, (width - maxW) / 2) * 0.94;
      const ry = Math.max(0, (height - maxH) / 2) * 0.94;
      return sizes.map((_, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
        return at(i, width / 2 + rx * Math.cos(angle), height / 2 + ry * Math.sin(angle));
      });
    }
    case "hub": {
      const outer = sizes.slice(1);
      const m = outer.length;
      const oW = Math.max(...outer.map((s) => s.w));
      const oH = Math.max(...outer.map((s) => s.h));
      const rx = Math.max(0, (width - oW) / 2) * 0.97;
      const ry = Math.max(0, (height - oH) / 2) * 0.97;
      return sizes.map((_, i) => {
        if (i === 0) return at(0, width / 2, height / 2);
        // Two spokes read best left and right; more go round from the top.
        const angle = m === 2 ? (i === 1 ? Math.PI : 0) : -Math.PI / 2 + (2 * Math.PI * (i - 1)) / m;
        return at(i, width / 2 + rx * Math.cos(angle), height / 2 + ry * Math.sin(angle));
      });
    }
  }
}

const center = (box: Box): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

/** The point where the line from the box's centre towards `toward` leaves the box, `gap` further out. */
export function edgePoint(box: Box, toward: Point, gap = 0): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const tx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty) + gap / Math.hypot(dx, dy);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export type Connector = {
  /** The line, for the SVG path's `d`. */
  d: string;
  /** The arrowhead, a filled triangle with its tip at the end. */
  head: string;
  /** Where a label goes: halfway along. */
  mid: Point;
  /** More up-and-down than across: a label sits beside it rather than on it. */
  vertical: boolean;
};

const r = (n: number) => Math.round(n * 10) / 10 || 0;

/**
 * An arrow from box `a` to box `b`. `bend` bows it sideways (a share of its
 * length); with `away` given, the bow always points away from that point, so
 * the arrows of a cycle curve outwards round the ring.
 */
export function connector(a: Box, b: Box, opts: { bend?: number; away?: Point; gap?: number; head?: number } = {}): Connector {
  const gap = opts.gap ?? 8;
  const size = opts.head ?? 12;
  const ca = center(a);
  const cb = center(b);
  let bend = opts.bend ?? 0;
  let start = edgePoint(a, cb, gap);
  let end = edgePoint(b, ca, gap);
  let control: Point | null = null;
  if (bend !== 0) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const make = (k: number) => ({ x: mid.x - dy * k * 0.5, y: mid.y + dx * k * 0.5 });
    control = make(bend);
    if (opts.away) {
      const outward = Math.hypot(control.x - opts.away.x, control.y - opts.away.y) >= Math.hypot(mid.x - opts.away.x, mid.y - opts.away.y);
      if (!outward) {
        bend = -bend;
        control = make(bend);
      }
    }
    start = edgePoint(a, control, gap);
    end = edgePoint(b, control, gap);
  }
  // The direction the head points: along the line, or along the curve's last stretch.
  const from = control ?? start;
  const len = Math.hypot(end.x - from.x, end.y - from.y) || 1;
  const ux = (end.x - from.x) / len;
  const uy = (end.y - from.y) / len;
  // The line stops under the head, so its round cap never pokes past the tip.
  const lineEnd = { x: end.x - ux * size * 0.6, y: end.y - uy * size * 0.6 };
  const d = control
    ? `M ${r(start.x)} ${r(start.y)} Q ${r(control.x)} ${r(control.y)} ${r(lineEnd.x)} ${r(lineEnd.y)}`
    : `M ${r(start.x)} ${r(start.y)} L ${r(lineEnd.x)} ${r(lineEnd.y)}`;
  const back = { x: end.x - ux * size, y: end.y - uy * size };
  const wing = size * 0.55;
  const head = `M ${r(end.x)} ${r(end.y)} L ${r(back.x - uy * wing)} ${r(back.y + ux * wing)} L ${r(back.x + uy * wing)} ${r(back.y - ux * wing)} Z`;
  const mid = control
    ? { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y }
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return { d, head, mid: { x: r(mid.x), y: r(mid.y) }, vertical: Math.abs(end.y - start.y) > Math.abs(end.x - start.x) };
}

/** Every arrow of a laid-out diagram. */
export function diagramConnectors(
  layout: DiagramLayout,
  boxes: readonly Box[],
  edges: readonly DiagramEdge[],
  width: number,
  height: number,
  unit: number,
): Connector[] {
  const away = { x: width / 2, y: height / 2 };
  return edges.map((edge) =>
    connector(boxes[edge.from], boxes[edge.to], {
      bend: layout === "cycle" ? 0.34 : 0,
      away: layout === "cycle" ? away : undefined,
      gap: Math.max(6, unit * 1.2),
      head: Math.max(9, unit * 1.9),
    }),
  );
}
