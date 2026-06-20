import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { db, schema } from "../../db/client";
import { eq } from "drizzle-orm";

interface ManagedServer {
  id: string;
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

class McpClientManager {
  private servers = new Map<string, ManagedServer>();

  async initAll(): Promise<void> {
    const configs = await db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.enabled, true));

    for (const config of configs) {
      try {
        await this.connectServer(config);
        console.log(`[mcp-client] Connected to "${config.name}" (${config.id})`);
      } catch (err) {
        console.error(
          `[mcp-client] Failed to connect to "${config.name}":`,
          (err as Error).message
        );
      }
    }
  }

  async connectServer(config: {
    id: string;
    name: string;
    command: string;
    args: string | null;
    env: string | null;
  }): Promise<void> {
    if (this.servers.has(config.id)) {
      await this.disconnectServer(config.id);
    }

    const args = JSON.parse(config.args || "[]") as string[];
    const env = JSON.parse(config.env || "{}") as Record<string, string>;

    const transport = new StdioClientTransport({
      command: config.command,
      args,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    const client = new Client({
      name: "ai-video-editor",
      version: "1.0.0",
    });

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools = toolsResult.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    this.servers.set(config.id, {
      id: config.id,
      name: config.name,
      client,
      transport,
      tools,
    });
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    try { await server.client.close(); } catch {}
    this.servers.delete(id);
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.servers.keys()) {
      await this.disconnectServer(id);
    }
  }

  async refreshServer(id: string): Promise<void> {
    const [config] = await db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id));
    if (!config || !config.enabled) {
      await this.disconnectServer(id);
      return;
    }
    await this.connectServer(config);
  }

  getAllToolDefinitions(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      for (const tool of server.tools) {
        defs.push({
          type: "function",
          function: {
            name: `mcp__${server.name}__${tool.name}`,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    }
    return defs;
  }

  async callTool(
    namespacedName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result: unknown }> {
    const parts = namespacedName.split("__");
    if (parts.length < 3 || parts[0] !== "mcp") {
      return { success: false, result: `Invalid external tool name: ${namespacedName}` };
    }

    const serverName = parts[1];
    const toolName = parts.slice(2).join("__");

    let target: ManagedServer | undefined;
    for (const server of this.servers.values()) {
      if (server.name === serverName) {
        target = server;
        break;
      }
    }

    if (!target) {
      return { success: false, result: `MCP server "${serverName}" is not connected` };
    }

    try {
      const result = await target.client.callTool({ name: toolName, arguments: args });
      const content = result.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { type: string; text?: string }) => c.text)
          .join("\n");
        return { success: !result.isError, result: textParts || content };
      }
      return { success: !result.isError, result: content };
    } catch (err) {
      return {
        success: false,
        result: `Error calling ${toolName} on "${serverName}": ${(err as Error).message}`,
      };
    }
  }

  isExternalTool(name: string): boolean {
    return name.startsWith("mcp__");
  }

  getConnectedServerIds(): string[] {
    return Array.from(this.servers.keys());
  }

  getServerTools(id: string): Array<{ name: string; description?: string }> | null {
    const server = this.servers.get(id);
    if (!server) return null;
    return server.tools.map((t) => ({ name: t.name, description: t.description }));
  }
}

export const mcpClientManager = new McpClientManager();
