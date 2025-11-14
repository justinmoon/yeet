/** @jsxImportSource react */
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useState } from "react";
import "@xyflow/react/dist/style.css";
import { machineToFlow } from "./machineToFlow";

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [task, setTask] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoadingMachine, setIsLoadingMachine] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadMachineConfig = async () => {
      try {
        const response = await fetch("/api/machine");
        if (!response.ok) {
          throw new Error(`Failed to load machine config (${response.status})`);
        }

        const data = await response.json();
        const { nodes, edges } = machineToFlow(data.config);

        if (!cancelled) {
          setNodes(nodes);
          setEdges(edges);
        }
      } catch (error: any) {
        if (!cancelled) {
          setLoadError(error.message || "Unable to load machine");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMachine(false);
        }
      }
    };

    loadMachineConfig();

    return () => {
      cancelled = true;
    };
  }, [setEdges, setNodes]);

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

          // Highlight active node and reset tool label when leaving executingTool
          setNodes((nodes) =>
            nodes.map((node) => {
              const isActive = node.id === data.state;

              // Reset executingTool label when transitioning away
              let label = node.data.label;
              if (
                node.id === "executingTool" &&
                !isActive &&
                node.data.baseLabel
              ) {
                label = node.data.baseLabel;
              }

              return {
                ...node,
                data: {
                  ...node.data,
                  label,
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

          // Update executingTool label to show current tool
          setNodes((nodes) =>
            nodes.map((node) => {
              if (node.id === "executingTool") {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    label: `🔧 ${data.tool}`,
                    baseLabel: node.data.baseLabel || "Executing Tool",
                  },
                };
              }
              return node;
            }),
          );
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
          disabled={
            !task.trim() || isRunning || isLoadingMachine || !!loadError
          }
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
          {isRunning ? "Running..." : loadError ? "Unavailable" : "Start"}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex" }}>
        {/* Canvas */}
        <div style={{ flex: 1, background: "#1e1e1e", position: "relative" }}>
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
          {(isLoadingMachine || loadError) && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(30, 30, 30, 0.9)",
                color: "#e0e0e0",
                fontSize: "0.9rem",
                fontWeight: 500,
              }}
            >
              {isLoadingMachine ? "Loading state machine…" : loadError}
            </div>
          )}
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
