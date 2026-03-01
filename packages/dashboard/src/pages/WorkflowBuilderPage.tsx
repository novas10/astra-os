import { useState, useCallback } from "react";
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Connection, type Node, type Edge,
  Handle, Position,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Play, Plus, Save, Trash2, Bot, Wrench, GitBranch,
  Layers, RotateCw, UserCheck, ArrowRightLeft,
} from "lucide-react";

// Custom node types
const NODE_TYPES_CONFIG = [
  { type: "llm_call", label: "LLM Call", icon: Bot, color: "border-blue-500 bg-blue-500/10" },
  { type: "tool_call", label: "Tool Call", icon: Wrench, color: "border-green-500 bg-green-500/10" },
  { type: "condition", label: "Condition", icon: GitBranch, color: "border-yellow-500 bg-yellow-500/10" },
  { type: "parallel", label: "Parallel", icon: Layers, color: "border-purple-500 bg-purple-500/10" },
  { type: "loop", label: "Loop", icon: RotateCw, color: "border-orange-500 bg-orange-500/10" },
  { type: "human_input", label: "Human Input", icon: UserCheck, color: "border-pink-500 bg-pink-500/10" },
  { type: "transform", label: "Transform", icon: ArrowRightLeft, color: "border-cyan-500 bg-cyan-500/10" },
];

function WorkflowNode({ data }: { data: { label: string; type: string; config?: Record<string, string> } }) {
  const cfg = NODE_TYPES_CONFIG.find((n) => n.type === data.type) || NODE_TYPES_CONFIG[0];
  const Icon = cfg.icon;

  return (
    <div className={`px-4 py-3 rounded-xl border-2 ${cfg.color} min-w-[180px] shadow-lg`}>
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-white" />
        <span className="text-sm font-medium text-white">{data.label}</span>
      </div>
      {data.config?.prompt && (
        <p className="text-xs text-gray-400 mt-1 truncate max-w-[160px]">{data.config.prompt}</p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

const nodeTypes = {
  workflow: WorkflowNode,
};

const INITIAL_NODES: Node[] = [
  { id: "1", type: "workflow", position: { x: 250, y: 50 }, data: { label: "User Input", type: "human_input" } },
  { id: "2", type: "workflow", position: { x: 250, y: 180 }, data: { label: "Process with LLM", type: "llm_call", config: { prompt: "Analyze the input..." } } },
  { id: "3", type: "workflow", position: { x: 100, y: 320 }, data: { label: "Check Result", type: "condition" } },
  { id: "4", type: "workflow", position: { x: 400, y: 320 }, data: { label: "Execute Tool", type: "tool_call" } },
  { id: "5", type: "workflow", position: { x: 250, y: 460 }, data: { label: "Format Output", type: "transform" } },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e1-2", source: "1", target: "2", animated: true, style: { stroke: "#5c7cfa" } },
  { id: "e2-3", source: "2", target: "3", style: { stroke: "#5c7cfa" } },
  { id: "e2-4", source: "2", target: "4", style: { stroke: "#5c7cfa" } },
  { id: "e3-5", source: "3", target: "5", style: { stroke: "#5c7cfa" } },
  { id: "e4-5", source: "4", target: "5", style: { stroke: "#5c7cfa" } },
];

export default function WorkflowBuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: "#5c7cfa" } }, eds)),
    [setEdges],
  );

  const addNode = (type: string, label: string) => {
    const id = `node_${Date.now()}`;
    const newNode: Node = {
      id,
      type: "workflow",
      position: { x: 250 + Math.random() * 100, y: 300 + Math.random() * 100 },
      data: { label, type },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900">
        <div>
          <h1 className="text-xl font-bold text-white">Workflow Builder</h1>
          <p className="text-xs text-gray-500">Visual DAG editor — drag nodes to build workflows</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary flex items-center gap-2 text-sm">
            <Save className="w-4 h-4" /> Save
          </button>
          <button className="btn-primary flex items-center gap-2 text-sm">
            <Play className="w-4 h-4" /> Run
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Node Palette */}
        <div className="w-56 bg-gray-900 border-r border-gray-800 p-4 space-y-2 overflow-y-auto">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Add Nodes</p>
          {NODE_TYPES_CONFIG.map(({ type, label, icon: Icon, color }) => (
            <button
              key={type}
              onClick={() => addNode(type, label)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border ${color} text-sm text-white hover:opacity-80 transition-opacity`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1f2937" gap={20} />
            <Controls
              className="!bg-gray-800 !border-gray-700 !rounded-lg !shadow-lg"
              style={{ button: { backgroundColor: "#374151", color: "#fff", borderColor: "#4b5563" } } as any}
            />
            <MiniMap
              nodeColor="#4c6ef5"
              maskColor="rgba(0, 0, 0, 0.7)"
              className="!bg-gray-900 !border-gray-700 !rounded-lg"
            />
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {selectedNode && (
          <div className="w-72 bg-gray-900 border-l border-gray-800 p-4 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Properties</h3>
              <button
                onClick={() => {
                  setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                  setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedNode(null);
                }}
                className="text-red-400 hover:text-red-300 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Label</label>
              <input
                type="text"
                value={selectedNode.data.label}
                onChange={(e) => {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === selectedNode.id
                        ? { ...n, data: { ...n.data, label: e.target.value } }
                        : n,
                    ),
                  );
                }}
                className="input w-full"
              />
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select
                value={selectedNode.data.type}
                onChange={(e) => {
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.id === selectedNode.id
                        ? { ...n, data: { ...n.data, type: e.target.value } }
                        : n,
                    ),
                  );
                }}
                className="input w-full"
              >
                {NODE_TYPES_CONFIG.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Node ID</label>
              <p className="text-xs font-mono text-gray-500">{selectedNode.id}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
