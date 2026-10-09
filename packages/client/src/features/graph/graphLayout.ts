// Pure graph layout math shared by the client graph controller and its
// tests. Ported from the Stimulus-era document_graph_controller.js without
// behavior change: same force constants, bounds, zoom limits, and label
// wrapping.

import type { GraphEdgeData, GraphNodeData } from "./graphView.js";

export interface GraphNodeState {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GraphLayoutData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

export const GRAPH_MIN_ZOOM = 0.55;
export const GRAPH_MAX_ZOOM = 2.5;

export function clampZoom(value: number): number {
  return Math.max(GRAPH_MIN_ZOOM, Math.min(GRAPH_MAX_ZOOM, value));
}

export function initNodeStates(data: GraphLayoutData): Map<string, GraphNodeState> {
  return new Map(
    data.nodes.map((node) => [
      String(node.id),
      {
        id: String(node.id),
        title: String(node.title ?? ""),
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        vx: 0,
        vy: 0,
      },
    ]),
  );
}

export function stepSimulation(states: Map<string, GraphNodeState>, edges: GraphEdgeData[]): void {
  const nodes = [...states.values()];
  nodes.forEach((node) => {
    node.vx = (node.vx || 0) * 0.82;
    node.vy = (node.vy || 0) * 0.82;
    node.vx += (500 - node.x) * 0.0008;
    node.vy += (310 - node.y) * 0.0008;
  });

  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const first = nodes[left];
      const second = nodes[right];
      if (!first || !second) continue;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const force = 2600 / (distance * distance);
      const x = (dx / distance) * force;
      const y = (dy / distance) * force;
      first.vx -= x;
      first.vy -= y;
      second.vx += x;
      second.vy += y;
    }
  }

  for (const edge of edges) {
    const source = states.get(String(edge.source));
    const target = states.get(String(edge.target));
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const force = (distance - 175) * 0.002;
    source.vx += (dx / distance) * force;
    source.vy += (dy / distance) * force;
    target.vx -= (dx / distance) * force;
    target.vy -= (dy / distance) * force;
  }

  nodes.forEach((node) => {
    node.x = Math.max(35, Math.min(965, node.x + node.vx));
    node.y = Math.max(35, Math.min(585, node.y + node.vy));
  });
}

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function edgeGeometry(source: GraphNodeState, target: GraphNodeState, nodeRadius = 18): EdgeGeometry {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const unitX = dx / distance;
  const unitY = dy / distance;
  return {
    x1: source.x + unitX * nodeRadius,
    y1: source.y + unitY * nodeRadius,
    x2: target.x - unitX * nodeRadius,
    y2: target.y - unitY * nodeRadius,
  };
}

export function wrapLabel(title: string, maxCharacters: number): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  const chunks = words.flatMap((word) => {
    const pieces = [];
    for (let index = 0; index < word.length; index += maxCharacters) pieces.push(word.slice(index, index + maxCharacters));
    return pieces;
  });
  const lines: string[] = [];
  let line = "";
  chunks.forEach((chunk) => {
    const candidate = line ? `${line} ${chunk}` : chunk;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = chunk;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function searchMatches(nodes: GraphNodeData[], query: string, limit = 8): GraphNodeData[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return nodes
    .filter((node) => String(node.title ?? "").toLowerCase().includes(normalized))
    .slice(0, limit);
}
