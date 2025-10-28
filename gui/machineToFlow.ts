/**
 * Convert XState machine to React Flow nodes and edges
 */

import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "dagre";

interface StateNode {
  key: string;
  type?: string;
  on?: Record<string, string | { target: string }>;
}

interface MachineDefinition {
  states: Record<string, StateNode>;
  initial: string;
}

/**
 * Extract states and transitions from XState machine
 */
export function machineToFlow(machine: any): { nodes: Node[]; edges: Edge[] } {
  // Extract states from the machine
  const states = Object.keys(machine.states || {});
  const initial = machine.initial || states[0];

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Create nodes for each state
  for (const stateKey of states) {
    const state = machine.states[stateKey];

    nodes.push({
      id: stateKey,
      type: "default",
      position: { x: 0, y: 0 }, // Will be positioned by dagre
      data: {
        label: formatStateLabel(stateKey),
        isActive: false,
      },
      className: stateKey, // For styling
    });

    // Extract event-based transitions (state.on)
    const transitions = state.on || {};
    for (const [event, target] of Object.entries(transitions)) {
      const targetState = typeof target === "string" ? target : target.target;

      if (targetState && targetState !== stateKey) {
        edges.push({
          id: `${stateKey}-${event}-${targetState}`,
          source: stateKey,
          target: targetState,
          label: formatEventLabel(event),
          type: "smoothstep",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#6b7280",
          },
          labelStyle: {
            fill: "#e0e0e0",
            fontSize: 12,
            fontWeight: 500,
          },
          labelBgStyle: {
            fill: "#1e1e1e",
            fillOpacity: 0.9,
          },
          labelBgPadding: [4, 4] as [number, number],
          labelBgBorderRadius: 4,
        });
      }
    }

    // Extract invoke-based transitions (state.invoke.onDone, onError)
    if (state.invoke) {
      const invoke = state.invoke;

      // Handle onDone transitions
      if (invoke.onDone) {
        const onDoneTransitions = Array.isArray(invoke.onDone)
          ? invoke.onDone
          : [invoke.onDone];

        for (const transition of onDoneTransitions) {
          const targetState =
            typeof transition === "string" ? transition : transition.target;

          if (targetState && targetState !== stateKey) {
            const hasGuard = typeof transition === "object" && transition.guard;
            const label = hasGuard ? `Done (${transition.guard})` : "Done";

            edges.push({
              id: `${stateKey}-onDone-${targetState}-${hasGuard || "default"}`,
              source: stateKey,
              target: targetState,
              label,
              type: "smoothstep",
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: hasGuard ? "#9ca3af" : "#6b7280",
              },
              labelStyle: {
                fill: hasGuard ? "#9ca3af" : "#d4d4d8",
                fontSize: 11,
                fontStyle: hasGuard ? "italic" : "normal",
              },
              labelBgStyle: {
                fill: "#1e1e1e",
                fillOpacity: 0.95,
              },
              labelBgPadding: [3, 3] as [number, number],
              labelBgBorderRadius: 3,
              style: hasGuard
                ? { strokeDasharray: "5,5", opacity: 0.7 }
                : undefined,
            });
          }
        }
      }

      // Handle onError transitions
      if (invoke.onError) {
        const targetState =
          typeof invoke.onError === "string"
            ? invoke.onError
            : invoke.onError.target;

        if (targetState && targetState !== stateKey) {
          edges.push({
            id: `${stateKey}-onError-${targetState}`,
            source: stateKey,
            target: targetState,
            label: "Error",
            type: "smoothstep",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#ef4444",
            },
            labelStyle: {
              fill: "#fca5a5",
              fontSize: 12,
              fontWeight: 600,
            },
            labelBgStyle: {
              fill: "#7f1d1d",
              fillOpacity: 0.95,
            },
            labelBgPadding: [4, 6] as [number, number],
            labelBgBorderRadius: 4,
            style: { stroke: "#ef4444", strokeWidth: 2 },
          });
        }
      }
    }
  }

  // Auto-layout with dagre
  const layouted = getLayoutedElements(nodes, edges);

  return layouted;
}

/**
 * Format state name for display
 */
function formatStateLabel(state: string): string {
  // Convert camelCase to Title Case
  return state
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Format event name for display
 */
function formatEventLabel(event: string): string {
  // Remove underscores, make lowercase
  return event
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (str) => str.toUpperCase());
}

/**
 * Auto-layout nodes using dagre
 */
function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "LR",
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // Better layout settings
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 100, // Horizontal spacing between nodes
    ranksep: 120, // Vertical spacing between ranks
    marginx: 40,
    marginy: 40,
    align: "DL", // Align nodes
  });

  const nodeWidth = 220;
  const nodeHeight = 70;

  for (const node of nodes) {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
