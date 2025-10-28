import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { agentMachine } from "../src/agent-machine";
import { machineToFlow } from "./machineToFlow";

// Convert XState machine to React Flow
const { nodes: initialNodes, edges: initialEdges } = machineToFlow(
  agentMachine.config,
);

export function App() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          background: "#252526",
          borderBottom: "1px solid #3e3e42",
          padding: "1rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#e0e0e0" }}>
          XState Agent Loop
        </h1>
      </div>
      <div style={{ flex: 1, background: "#1e1e1e" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
        >
          <Background color="#3e3e42" gap={16} />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
