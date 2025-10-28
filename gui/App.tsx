import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useState } from "react";
import "@xyflow/react/dist/style.css";
import { agentMachine } from "../src/agent-machine";
import { machineToFlow } from "./machineToFlow";

// Convert XState machine to React Flow
const { nodes: initialNodes, edges: initialEdges } = machineToFlow(
  agentMachine.config,
);

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const handleStart = async () => {
    if (!task.trim() || isRunning) return;

    setIsRunning(true);
    setLogs([]);
    setActiveState("idle");

    try {
      // Connect to SSE endpoint
      const eventSource = new EventSource(
        `/api/execute?task=${encodeURIComponent(task)}`,
      );

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "state") {
          setActiveState(data.state);
          setLogs((prev) => [...prev, `→ ${data.state}`]);

          // Highlight active node - add className for CSS animation
          setNodes((nodes) =>
            nodes.map((node) => {
              const isActive = node.id === data.state;
              return {
                ...node,
                data: {
                  ...node.data,
                  isActive,
                },
                className: isActive ? `${node.id} active-state` : node.id,
                style: isActive
                  ? {
                      borderWidth: "3px",
                      borderColor: "#3b82f6",
                    }
                  : {
                      borderWidth: "2px",
                    },
              };
            }),
          );
        } else if (data.type === "tool") {
          setLogs((prev) => [...prev, `🔧 ${data.tool}: ${data.args}`]);
        } else if (data.type === "done") {
          setLogs((prev) => [...prev, "✅ Complete"]);
          setIsRunning(false);
          setActiveState(null);
          eventSource.close();

          // Reset highlighting
          setNodes((nodes) =>
            nodes.map((node) => ({
              ...node,
              data: {
                ...node.data,
                isActive: false,
              },
            })),
          );
        } else if (data.type === "error") {
          setLogs((prev) => [...prev, `❌ Error: ${data.error}`]);
          setIsRunning(false);
          setActiveState(null);
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        setLogs((prev) => [...prev, "❌ Connection error"]);
        setIsRunning(false);
        setActiveState(null);
        eventSource.close();
      };
    } catch (error) {
      setLogs((prev) => [...prev, `❌ ${error}`]);
      setIsRunning(false);
      setActiveState(null);
    }
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Control Panel */}
      <div
        style={{
          background: "#1e1e1e",
          borderBottom: "1px solid #3e3e42",
          padding: "1rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Enter task (e.g., 'write a hello world script')"
          disabled={isRunning}
          style={{
            flex: 1,
            padding: "0.5rem",
            background: "#2d2d30",
            border: "1px solid #3e3e42",
            borderRadius: "4px",
            color: "#e0e0e0",
            fontSize: "0.875rem",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleStart();
          }}
        />
        <button
          type="button"
          onClick={handleStart}
          disabled={!task.trim() || isRunning}
          style={{
            padding: "0.5rem 1rem",
            background: isRunning ? "#6b7280" : "#007acc",
            border: "none",
            borderRadius: "4px",
            color: "#fff",
            cursor: isRunning || !task.trim() ? "not-allowed" : "pointer",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          {isRunning ? "Running..." : "Start"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex" }}>
        {/* Canvas */}
        <div style={{ flex: 1, background: "#1e1e1e" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesDraggable={true}
            nodesConnectable={false}
            elementsSelectable={true}
            fitView
            fitViewOptions={{
              padding: 0.2,
              minZoom: 0.3,
              maxZoom: 1.5,
            }}
            defaultEdgeOptions={{
              type: "smoothstep",
            }}
          >
            <Background color="#3e3e42" gap={16} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Logs Panel */}
        {logs.length > 0 && (
          <div
            style={{
              width: "300px",
              background: "#252526",
              borderLeft: "1px solid #3e3e42",
              padding: "1rem",
              overflowY: "auto",
            }}
          >
            <h3
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#e0e0e0",
                marginBottom: "0.5rem",
              }}
            >
              Execution Log
            </h3>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#8e8e93",
                fontFamily: "monospace",
              }}
            >
              {logs.map((log, i) => (
                <div
                  key={`log-${i}-${log.substring(0, 10)}`}
                  style={{ marginBottom: "0.25rem" }}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
