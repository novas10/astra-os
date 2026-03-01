/**
 * AstraOS — A2A Agent Card
 * Generates the /.well-known/agent.json descriptor per the Agent-to-Agent protocol.
 */

export interface AgentCardCapability {
  name: string;
  description: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: AgentCardCapability[];
  skills: string[];
  protocols: string[];
  authentication?: { type: string; instructions?: string };
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

export function generateAgentCard(config: {
  baseUrl: string;
  skills: string[];
  tools: string[];
  providers: string[];
  channels: string[];
}): AgentCard {
  return {
    name: "AstraOS",
    description: "Autonomous AI agent OS with self-healing, multi-LLM, 10+ channels, voice, browser control, Canvas/A2UI, and plugin skills.",
    url: config.baseUrl,
    version: "2.1.0",
    capabilities: [
      { name: "text_generation", description: "Generate text responses using multi-LLM providers" },
      { name: "code_execution", description: "Execute code in sandboxed Docker containers" },
      { name: "web_browsing", description: "Navigate and interact with web pages via Chrome CDP" },
      { name: "file_operations", description: "Read and write files in sandboxed workspace" },
      { name: "voice", description: "Text-to-speech and speech-to-text capabilities" },
      { name: "canvas", description: "Generate interactive HTML UIs (A2UI)" },
      { name: "memory", description: "Persistent episodic + vector + graph memory" },
      { name: "scheduling", description: "Schedule tasks with cron expressions" },
      ...config.tools.map((t) => ({ name: t, description: `Tool: ${t}` })),
    ],
    skills: config.skills,
    protocols: ["a2a", "mcp"],
    authentication: {
      type: "bearer",
      instructions: "Provide API key via Authorization: Bearer <token> header",
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
  };
}
