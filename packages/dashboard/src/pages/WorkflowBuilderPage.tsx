import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Connection, type Node, type Edge,
  Handle, Position, type NodeProps,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Play, Save, Trash2, Bot, Wrench, GitBranch,
  Layers, RotateCw, UserCheck, ArrowRightLeft, CheckCircle, AlertCircle,
  Plus, FileText, Zap, Globe, Database, Clock, Mail,
  Code2, Image, Search, Shield, Copy, Download, Upload,
  ChevronRight, X, Sparkles, LayoutTemplate,
} from "lucide-react";
import { saveWorkflow, runWorkflow } from "../lib/api";

// ─── Node Type Definitions ───
const NODE_CATEGORIES = [
  {
    category: "AI & Logic",
    nodes: [
      { type: "llm_call", label: "LLM Call", icon: Bot, color: "blue", desc: "Call Claude, GPT-4o, Gemini" },
      { type: "condition", label: "Condition", icon: GitBranch, color: "yellow", desc: "Branch based on expression" },
      { type: "transform", label: "Transform", icon: ArrowRightLeft, color: "cyan", desc: "Transform data with JS" },
      { type: "code", label: "Run Code", icon: Code2, color: "emerald", desc: "Execute custom code" },
    ],
  },
  {
    category: "Flow Control",
    nodes: [
      { type: "parallel", label: "Parallel", icon: Layers, color: "purple", desc: "Run branches concurrently" },
      { type: "loop", label: "Loop", icon: RotateCw, color: "orange", desc: "Iterate over array" },
      { type: "delay", label: "Delay", icon: Clock, color: "slate", desc: "Wait before continuing" },
      { type: "human_input", label: "Human Input", icon: UserCheck, color: "pink", desc: "Wait for user response" },
    ],
  },
  {
    category: "Actions",
    nodes: [
      { type: "tool_call", label: "Tool Call", icon: Wrench, color: "green", desc: "Execute a skill/tool" },
      { type: "api_call", label: "API Call", icon: Globe, color: "indigo", desc: "HTTP request to external API" },
      { type: "email", label: "Send Email", icon: Mail, color: "red", desc: "Send notification email" },
      { type: "memory", label: "Memory", icon: Database, color: "violet", desc: "Read/write memory store" },
    ],
  },
  {
    category: "Data",
    nodes: [
      { type: "search", label: "Search", icon: Search, color: "teal", desc: "Search web or knowledge" },
      { type: "image_gen", label: "Image Gen", icon: Image, color: "fuchsia", desc: "Generate image with AI" },
      { type: "file_op", label: "File Op", icon: FileText, color: "amber", desc: "Read/write/transform files" },
      { type: "webhook", label: "Webhook", icon: Zap, color: "lime", desc: "Trigger or receive webhooks" },
    ],
  },
];

const ALL_NODE_TYPES = NODE_CATEGORIES.flatMap((c) => c.nodes);

const COLOR_MAP: Record<string, { border: string; bg: string; shadow: string }> = {
  blue: { border: "border-blue-500", bg: "bg-blue-500/10", shadow: "shadow-blue-500/20" },
  green: { border: "border-green-500", bg: "bg-green-500/10", shadow: "shadow-green-500/20" },
  yellow: { border: "border-yellow-500", bg: "bg-yellow-500/10", shadow: "shadow-yellow-500/20" },
  purple: { border: "border-purple-500", bg: "bg-purple-500/10", shadow: "shadow-purple-500/20" },
  orange: { border: "border-orange-500", bg: "bg-orange-500/10", shadow: "shadow-orange-500/20" },
  pink: { border: "border-pink-500", bg: "bg-pink-500/10", shadow: "shadow-pink-500/20" },
  cyan: { border: "border-cyan-500", bg: "bg-cyan-500/10", shadow: "shadow-cyan-500/20" },
  red: { border: "border-red-500", bg: "bg-red-500/10", shadow: "shadow-red-500/20" },
  indigo: { border: "border-indigo-500", bg: "bg-indigo-500/10", shadow: "shadow-indigo-500/20" },
  emerald: { border: "border-emerald-500", bg: "bg-emerald-500/10", shadow: "shadow-emerald-500/20" },
  violet: { border: "border-violet-500", bg: "bg-violet-500/10", shadow: "shadow-violet-500/20" },
  teal: { border: "border-teal-500", bg: "bg-teal-500/10", shadow: "shadow-teal-500/20" },
  fuchsia: { border: "border-fuchsia-500", bg: "bg-fuchsia-500/10", shadow: "shadow-fuchsia-500/20" },
  amber: { border: "border-amber-500", bg: "bg-amber-500/10", shadow: "shadow-amber-500/20" },
  lime: { border: "border-lime-500", bg: "bg-lime-500/10", shadow: "shadow-lime-500/20" },
  slate: { border: "border-slate-500", bg: "bg-slate-500/10", shadow: "shadow-slate-500/20" },
};

// ─── Workflow Templates ───
interface WorkflowTemplate {
  name: string;
  desc: string;
  icon: typeof Bot;
  nodes: Node[];
  edges: Edge[];
}

const TEMPLATES: WorkflowTemplate[] = [
  {
    name: "Customer Support Bot",
    desc: "Classify inquiry, search KB, generate response",
    icon: Bot,
    nodes: [
      { id: "1", type: "workflow", position: { x: 300, y: 40 }, data: { label: "Customer Message", type: "human_input" } },
      { id: "2", type: "workflow", position: { x: 300, y: 160 }, data: { label: "Classify Intent", type: "llm_call", config: { prompt: "Classify: billing, technical, general", model: "claude-sonnet" } } },
      { id: "3", type: "workflow", position: { x: 120, y: 290 }, data: { label: "Is Technical?", type: "condition", config: { condition: "result.intent === 'technical'" } } },
      { id: "4", type: "workflow", position: { x: 480, y: 290 }, data: { label: "Search Knowledge Base", type: "search", config: { source: "memory" } } },
      { id: "5", type: "workflow", position: { x: 120, y: 420 }, data: { label: "Escalate to Human", type: "email", config: { to: "support@company.com" } } },
      { id: "6", type: "workflow", position: { x: 480, y: 420 }, data: { label: "Generate Response", type: "llm_call", config: { prompt: "Answer using KB context", model: "claude-sonnet" } } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2", animated: true },
      { id: "e2-3", source: "2", target: "3" },
      { id: "e2-4", source: "2", target: "4" },
      { id: "e3-5", source: "3", target: "5" },
      { id: "e4-6", source: "4", target: "6" },
    ],
  },
  {
    name: "Data Pipeline",
    desc: "Fetch, transform, validate, store",
    icon: Database,
    nodes: [
      { id: "1", type: "workflow", position: { x: 300, y: 40 }, data: { label: "Fetch Data", type: "api_call", config: { method: "GET", url: "https://api.example.com/data" } } },
      { id: "2", type: "workflow", position: { x: 300, y: 160 }, data: { label: "Transform", type: "transform", config: { expression: "data.map(d => ({ ...d, processed: true }))" } } },
      { id: "3", type: "workflow", position: { x: 300, y: 280 }, data: { label: "Validate", type: "condition", config: { condition: "result.length > 0" } } },
      { id: "4", type: "workflow", position: { x: 300, y: 400 }, data: { label: "Store in Memory", type: "memory", config: { operation: "write" } } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2", animated: true },
      { id: "e2-3", source: "2", target: "3" },
      { id: "e3-4", source: "3", target: "4" },
    ],
  },
  {
    name: "Content Generator",
    desc: "Generate, review, publish content",
    icon: Sparkles,
    nodes: [
      { id: "1", type: "workflow", position: { x: 300, y: 40 }, data: { label: "Topic Input", type: "human_input" } },
      { id: "2", type: "workflow", position: { x: 300, y: 160 }, data: { label: "Research", type: "search", config: { source: "web" } } },
      { id: "3", type: "workflow", position: { x: 120, y: 290 }, data: { label: "Write Draft", type: "llm_call", config: { prompt: "Write article using research", model: "claude-opus" } } },
      { id: "4", type: "workflow", position: { x: 480, y: 290 }, data: { label: "Generate Image", type: "image_gen", config: { style: "editorial" } } },
      { id: "5", type: "workflow", position: { x: 300, y: 420 }, data: { label: "Review & Publish", type: "human_input" } },
    ],
    edges: [
      { id: "e1-2", source: "1", target: "2", animated: true },
      { id: "e2-3", source: "2", target: "3" },
      { id: "e2-4", source: "2", target: "4" },
      { id: "e3-5", source: "3", target: "5" },
      { id: "e4-5", source: "4", target: "5" },
    ],
  },
  {
    name: "Blank Canvas",
    desc: "Start from scratch",
    icon: Plus,
    nodes: [],
    edges: [],
  },
];

const DEFAULT_EDGES_STYLE = { stroke: "#6366f1", strokeWidth: 2 };

// ─── Custom Node Component ───
function WorkflowNode({ data, selected }: NodeProps) {
  const cfg = ALL_NODE_TYPES.find((n) => n.type === data.type) || ALL_NODE_TYPES[0];
  const Icon = cfg.icon;
  const colors = COLOR_MAP[cfg.color] || COLOR_MAP.blue;

  return (
    <div
      className={`group px-4 py-3 rounded-xl border-2 ${colors.border} ${colors.bg} min-w-[200px] shadow-lg ${colors.shadow} backdrop-blur-sm transition-all duration-200 ${selected ? "ring-2 ring-white/20 scale-105" : "hover:scale-[1.02]"}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-3 !h-3 !border-2 !border-gray-600 hover:!bg-white transition-colors" />
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-white block">{data.label}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">{cfg.label}</span>
        </div>
      </div>
      {data.config?.prompt && (
        <p className="text-xs text-gray-400 mt-2 truncate max-w-[180px] bg-black/20 rounded px-2 py-1">{data.config.prompt}</p>
      )}
      {data.config?.model && (
        <span className="inline-block text-[10px] mt-1.5 px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">{data.config.model}</span>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-3 !h-3 !border-2 !border-gray-600 hover:!bg-white transition-colors" />
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNode };

// ─── Node Config Panel ───
function NodeConfigPanel({
  node,
  onUpdate,
  onDelete,
  onClose,
}: {
  node: Node;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const cfg = ALL_NODE_TYPES.find((n) => n.type === node.data.type) || ALL_NODE_TYPES[0];
  const Icon = cfg.icon;
  const config = node.data.config || {};

  const updateConfig = (key: string, value: string) => {
    onUpdate(node.id, { ...node.data, config: { ...config, [key]: value } });
  };

  const updateLabel = (label: string) => {
    onUpdate(node.id, { ...node.data, label });
  };

  const updateType = (type: string) => {
    onUpdate(node.id, { ...node.data, type });
  };

  return (
    <div className="w-80 bg-gray-900/95 backdrop-blur-xl border-l border-gray-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-bold text-white">Node Properties</h3>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Label</label>
          <input
            type="text"
            value={node.data.label}
            onChange={(e) => updateLabel(e.target.value)}
            className="input w-full"
            placeholder="Node name"
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wider block mb-1.5">Node Type</label>
          <select value={node.data.type} onChange={(e) => updateType(e.target.value)} className="input w-full">
            {ALL_NODE_TYPES.map((t) => (
              <option key={t.type} value={t.type}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Configuration</p>
        </div>

        {/* Type-specific config */}
        {(node.data.type === "llm_call") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Model</label>
              <select value={config.model || ""} onChange={(e) => updateConfig("model", e.target.value)} className="input w-full">
                <option value="">Auto-detect</option>
                <option value="claude-sonnet">Claude Sonnet</option>
                <option value="claude-opus">Claude Opus</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gemini-pro">Gemini Pro</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">System Prompt</label>
              <textarea
                value={config.prompt || ""}
                onChange={(e) => updateConfig("prompt", e.target.value)}
                className="input w-full h-24 resize-none"
                placeholder="Enter system prompt..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Temperature</label>
              <input
                type="range" min="0" max="100"
                value={(parseFloat(config.temperature || "0.7") * 100).toString()}
                onChange={(e) => updateConfig("temperature", (parseInt(e.target.value) / 100).toString())}
                className="w-full accent-blue-500"
              />
              <span className="text-xs text-gray-500">{config.temperature || "0.7"}</span>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Output Variable</label>
              <input
                type="text" value={config.outputVar || "result"}
                onChange={(e) => updateConfig("outputVar", e.target.value)}
                className="input w-full" placeholder="result"
              />
            </div>
          </>
        )}

        {(node.data.type === "condition") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Condition Expression</label>
              <textarea
                value={config.condition || ""}
                onChange={(e) => updateConfig("condition", e.target.value)}
                className="input w-full h-20 resize-none font-mono text-xs"
                placeholder="result.status === 'success'"
              />
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-500">
              <p className="font-medium text-gray-400 mb-1">Available variables:</p>
              <p className="font-mono">result, input, loopIndex, loopItem</p>
            </div>
          </>
        )}

        {(node.data.type === "transform") && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">JS Expression</label>
            <textarea
              value={config.expression || ""}
              onChange={(e) => updateConfig("expression", e.target.value)}
              className="input w-full h-28 resize-none font-mono text-xs"
              placeholder="data.map(item => item.name)"
            />
          </div>
        )}

        {(node.data.type === "api_call") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Method</label>
              <select value={config.method || "GET"} onChange={(e) => updateConfig("method", e.target.value)} className="input w-full">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">URL</label>
              <input
                type="text" value={config.url || ""}
                onChange={(e) => updateConfig("url", e.target.value)}
                className="input w-full font-mono text-xs" placeholder="https://api.example.com/data"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Headers (JSON)</label>
              <textarea
                value={config.headers || ""}
                onChange={(e) => updateConfig("headers", e.target.value)}
                className="input w-full h-16 resize-none font-mono text-xs"
                placeholder='{"Authorization": "Bearer ..."}'
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Body (JSON)</label>
              <textarea
                value={config.body || ""}
                onChange={(e) => updateConfig("body", e.target.value)}
                className="input w-full h-16 resize-none font-mono text-xs"
                placeholder='{"key": "value"}'
              />
            </div>
          </>
        )}

        {(node.data.type === "tool_call") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Skill / Tool Name</label>
              <input
                type="text" value={config.tool || ""}
                onChange={(e) => updateConfig("tool", e.target.value)}
                className="input w-full" placeholder="weather, calculator, web-search..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Arguments (JSON)</label>
              <textarea
                value={config.args || ""}
                onChange={(e) => updateConfig("args", e.target.value)}
                className="input w-full h-20 resize-none font-mono text-xs"
                placeholder='{"query": "weather in Chennai"}'
              />
            </div>
          </>
        )}

        {(node.data.type === "delay") && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Delay (seconds)</label>
            <input
              type="number" value={config.seconds || "5"}
              onChange={(e) => updateConfig("seconds", e.target.value)}
              className="input w-full" min="1" max="3600"
            />
          </div>
        )}

        {(node.data.type === "loop") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Loop Variable</label>
              <input
                type="text" value={config.loopVar || "items"}
                onChange={(e) => updateConfig("loopVar", e.target.value)}
                className="input w-full font-mono text-xs" placeholder="items"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Max Iterations</label>
              <input
                type="number" value={config.maxIterations || "100"}
                onChange={(e) => updateConfig("maxIterations", e.target.value)}
                className="input w-full" min="1" max="10000"
              />
            </div>
          </>
        )}

        {(node.data.type === "email") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">To</label>
              <input type="text" value={config.to || ""} onChange={(e) => updateConfig("to", e.target.value)} className="input w-full" placeholder="user@example.com" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Subject</label>
              <input type="text" value={config.subject || ""} onChange={(e) => updateConfig("subject", e.target.value)} className="input w-full" placeholder="Notification" />
            </div>
          </>
        )}

        {(node.data.type === "code") && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Code (JavaScript)</label>
            <textarea
              value={config.code || ""}
              onChange={(e) => updateConfig("code", e.target.value)}
              className="input w-full h-32 resize-none font-mono text-xs"
              placeholder="// Your code here&#10;return data;"
            />
          </div>
        )}

        {(node.data.type === "memory") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Operation</label>
              <select value={config.operation || "read"} onChange={(e) => updateConfig("operation", e.target.value)} className="input w-full">
                <option value="read">Read</option>
                <option value="write">Write</option>
                <option value="search">Search</option>
                <option value="delete">Delete</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Key / Query</label>
              <input type="text" value={config.key || ""} onChange={(e) => updateConfig("key", e.target.value)} className="input w-full" placeholder="memory key or search query" />
            </div>
          </>
        )}

        {(node.data.type === "search") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Source</label>
              <select value={config.source || "web"} onChange={(e) => updateConfig("source", e.target.value)} className="input w-full">
                <option value="web">Web Search</option>
                <option value="memory">Memory / RAG</option>
                <option value="knowledge">Knowledge Graph</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Query</label>
              <input type="text" value={config.query || ""} onChange={(e) => updateConfig("query", e.target.value)} className="input w-full" placeholder="Search query..." />
            </div>
          </>
        )}

        {(node.data.type === "image_gen") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Prompt</label>
              <textarea value={config.prompt || ""} onChange={(e) => updateConfig("prompt", e.target.value)} className="input w-full h-20 resize-none" placeholder="Describe the image..." />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Style</label>
              <select value={config.style || "natural"} onChange={(e) => updateConfig("style", e.target.value)} className="input w-full">
                <option value="natural">Natural</option>
                <option value="editorial">Editorial</option>
                <option value="artistic">Artistic</option>
                <option value="technical">Technical / Diagram</option>
              </select>
            </div>
          </>
        )}

        {(node.data.type === "webhook") && (
          <>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Mode</label>
              <select value={config.mode || "trigger"} onChange={(e) => updateConfig("mode", e.target.value)} className="input w-full">
                <option value="trigger">Trigger (outgoing)</option>
                <option value="receive">Receive (incoming)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">URL</label>
              <input type="text" value={config.url || ""} onChange={(e) => updateConfig("url", e.target.value)} className="input w-full font-mono text-xs" placeholder="https://hooks.example.com/..." />
            </div>
          </>
        )}

        {/* Node ID */}
        <div className="pt-2 border-t border-gray-800">
          <label className="text-xs text-gray-500 block mb-1">Node ID</label>
          <p className="text-xs font-mono text-gray-600 bg-gray-800/50 rounded px-2 py-1">{node.id}</p>
        </div>
      </div>

      {/* Footer actions */}
      <div className="p-4 border-t border-gray-800 flex gap-2">
        <button
          onClick={() => onDelete(node.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete Node
        </button>
        <button
          onClick={onClose}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-sm font-medium"
        >
          <CheckCircle className="w-3.5 h-3.5" /> Done
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───
export default function WorkflowBuilderPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState(TEMPLATES[0].nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    TEMPLATES[0].edges.map((e) => ({ ...e, style: DEFAULT_EDGES_STYLE, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" } })),
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [runResult, setRunResult] = useState<{ status: string; history: Array<{ nodeId: string; result: unknown; timestamp: number }> } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [workflowName, setWorkflowName] = useState("My Workflow");
  const nodeIdCounter = useRef(100);

  const buildWorkflowDefinition = () => {
    const id = savedId || `wf_${Date.now()}`;
    const entryNode = nodes.length > 0 ? nodes[0].id : "";
    const edgeMap = new Map<string, string[]>();
    for (const e of edges) {
      const existing = edgeMap.get(e.source) || [];
      existing.push(e.target);
      edgeMap.set(e.source, existing);
    }
    return {
      id,
      name: workflowName,
      description: "Built with the visual workflow editor",
      version: "1.0.0",
      entryNode,
      variables: {},
      nodes: nodes.map((n) => {
        const nexts = edgeMap.get(n.id) || [];
        return {
          id: n.id,
          type: n.data.type,
          name: n.data.label,
          config: n.data.config || {},
          next: nexts.length === 1 ? nexts[0] : nexts.length > 1 ? nexts : undefined,
        };
      }),
    };
  };

  const saveMutation = useMutation({
    mutationFn: () => saveWorkflow(buildWorkflowDefinition()),
    onSuccess: (data) => setSavedId(data.id),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!savedId) {
        const saved = await saveWorkflow(buildWorkflowDefinition());
        setSavedId(saved.id);
        return runWorkflow(saved.id);
      }
      return runWorkflow(savedId);
    },
    onSuccess: (data) => setRunResult({ status: data.status, history: data.history }),
  });

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge({ ...params, animated: true, style: DEFAULT_EDGES_STYLE, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" } }, eds)),
    [setEdges],
  );

  const addNode = (type: string, label: string) => {
    nodeIdCounter.current += 1;
    const id = `node_${nodeIdCounter.current}`;
    const newNode: Node = {
      id,
      type: "workflow",
      position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: { label, type, config: {} },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const loadTemplate = (template: WorkflowTemplate) => {
    setNodes(template.nodes);
    setEdges(template.edges.map((e) => ({ ...e, style: DEFAULT_EDGES_STYLE, markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" } })));
    setWorkflowName(template.name);
    setSelectedNode(null);
    setRunResult(null);
    setSavedId(null);
    setShowTemplates(false);
  };

  const updateNodeData = (id: string, data: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)));
    if (selectedNode?.id === id) {
      setSelectedNode((prev) => prev ? { ...prev, data } : null);
    }
  };

  const deleteNode = (id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNode(null);
  };

  const filteredCategories = NODE_CATEGORIES.map((cat) => ({
    ...cat,
    nodes: cat.nodes.filter((n) =>
      n.label.toLowerCase().includes(paletteSearch.toLowerCase()) ||
      n.desc.toLowerCase().includes(paletteSearch.toLowerCase()),
    ),
  })).filter((cat) => cat.nodes.length > 0);

  const exportWorkflow = () => {
    const def = buildWorkflowDefinition();
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowName.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-gray-950">
      {/* Top Toolbar */}
      <div className="px-4 py-3 border-b border-gray-800/80 flex items-center justify-between bg-gray-900/80 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <input
              type="text"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="bg-transparent text-lg font-bold text-white border-none outline-none w-56"
            />
          </div>

          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors text-xs font-medium"
          >
            <LayoutTemplate className="w-3.5 h-3.5" /> Templates
          </button>

          {saveMutation.isSuccess && (
            <span className="badge-green flex items-center gap-1 text-xs"><CheckCircle className="w-3 h-3" /> Saved</span>
          )}
          {(saveMutation.isError || runMutation.isError) && (
            <span className="badge-red flex items-center gap-1 text-xs"><AlertCircle className="w-3 h-3" /> Error</span>
          )}
          {runMutation.isPending && (
            <span className="badge-yellow flex items-center gap-1 text-xs">
              <div className="w-3 h-3 border-2 border-yellow-300/30 border-t-yellow-300 rounded-full animate-spin" /> Running
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-2">{nodes.length} nodes &middot; {edges.length} edges</span>

          <button onClick={exportWorkflow} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-colors" title="Export JSON">
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            {saveMutation.isPending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {runMutation.isPending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
            Run
          </button>
        </div>
      </div>

      {/* Template Selector Modal */}
      {showTemplates && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-2xl w-full mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <LayoutTemplate className="w-5 h-5 text-indigo-400" /> Workflow Templates
              </h2>
              <button onClick={() => setShowTemplates(false)} className="text-gray-500 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => loadTemplate(t)}
                  className="text-left p-4 rounded-xl border border-gray-700 hover:border-indigo-500 bg-gray-800/50 hover:bg-indigo-500/5 transition-all group"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
                      <t.icon className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{t.name}</h3>
                      <p className="text-xs text-gray-500">{t.nodes.length} nodes</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Node Palette */}
        <div className="w-60 bg-gray-900/95 backdrop-blur-xl border-r border-gray-800/80 flex flex-col overflow-hidden">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                className="input w-full pl-8 text-xs"
                placeholder="Search nodes..."
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
            {filteredCategories.map(({ category, nodes: catNodes }) => (
              <div key={category}>
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">{category}</p>
                <div className="space-y-1">
                  {catNodes.map(({ type, label, icon: Icon, color, desc }) => {
                    const colors = COLOR_MAP[color] || COLOR_MAP.blue;
                    return (
                      <button
                        key={type}
                        onClick={() => addNode(type, label)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border ${colors.border} ${colors.bg} text-left hover:opacity-90 transition-all group`}
                      >
                        <Icon className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-white block">{label}</span>
                          <span className="text-[10px] text-gray-500 block truncate">{desc}</span>
                        </div>
                        <Plus className="w-3 h-3 text-gray-600 group-hover:text-gray-300 ml-auto flex-shrink-0 transition-colors" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: DEFAULT_EDGES_STYLE,
              markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
            }}
          >
            <Background color="#1e1b4b" gap={24} size={1} />
            <Controls className="!bg-gray-800/90 !backdrop-blur !border-gray-700 !rounded-xl !shadow-2xl" />
            <MiniMap
              nodeColor="#6366f1"
              maskColor="rgba(0, 0, 0, 0.75)"
              className="!bg-gray-900/90 !backdrop-blur !border-gray-700 !rounded-xl"
              style={{ width: 160, height: 100 }}
            />
          </ReactFlow>

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-8 h-8 text-indigo-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-400 mb-1">Empty Canvas</h3>
                <p className="text-sm text-gray-600">Add nodes from the palette or load a template</p>
              </div>
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onUpdate={updateNodeData}
            onDelete={deleteNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>

      {/* Run Results */}
      {runResult && (
        <div className="border-t border-gray-800 bg-gray-900/95 backdrop-blur-xl">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-white">Execution Result</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${runResult.status === "completed" ? "bg-green-500/10 text-green-400" : runResult.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                {runResult.status}
              </span>
              <span className="text-xs text-gray-500">{runResult.history.length} steps executed</span>
            </div>
            <button onClick={() => setRunResult(null)} className="text-gray-500 hover:text-white p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 pb-3 max-h-40 overflow-y-auto">
            <div className="space-y-1">
              {runResult.history.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-xs font-mono bg-gray-800/50 rounded-lg px-3 py-2">
                  <span className="text-gray-600 w-5">{i + 1}</span>
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                  <span className="text-indigo-400 font-semibold w-24 truncate">{h.nodeId}</span>
                  <span className="text-gray-400 flex-1 truncate">{JSON.stringify(h.result).slice(0, 120)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
