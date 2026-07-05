import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { normalizeTomlText } from "@/utils/textNormalization";
import { McpServerSpec } from "../types";

export const validateToml = (text: string): string => {
  if (!text.trim()) return "";
  try {
    const normalized = normalizeTomlText(text);
    const parsed = parseToml(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "mustBeObject";
    }
    return "";
  } catch (e: any) {
    return e?.message || "parseError";
  }
};

export const mcpServerToToml = (server: McpServerSpec): string => {
  const obj: any = { ...server };

  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }

  return stringifyToml(obj).trim();
};

export const tomlToMcpServer = (tomlText: string): McpServerSpec => {
  if (!tomlText.trim()) {
    throw new Error("TOML content cannot be empty");
  }

  const parsed = parseToml(normalizeTomlText(tomlText));

  if (
    parsed.type ||
    parsed.command ||
    parsed.url ||
    parsed.args ||
    parsed.env
  ) {
    return normalizeServerConfig(parsed);
  }

  if (parsed.mcp_servers && typeof parsed.mcp_servers === "object") {
    const serverIds = Object.keys(parsed.mcp_servers);
    if (serverIds.length > 0) {
      const firstServer = (parsed.mcp_servers as any)[serverIds[0]];
      return normalizeServerConfig(firstServer);
    }
  }

  if (parsed.mcp && typeof parsed.mcp === "object") {
    const mcpObj = parsed.mcp as any;
    if (mcpObj.servers && typeof mcpObj.servers === "object") {
      const serverIds = Object.keys(mcpObj.servers);
      if (serverIds.length > 0) {
        const firstServer = mcpObj.servers[serverIds[0]];
        return normalizeServerConfig(firstServer);
      }
    }
  }

  throw new Error(
    "Unrecognized TOML format. Please provide a single MCP server configuration, or use [mcp_servers.<id>] format",
  );
};

function normalizeServerConfig(config: any): McpServerSpec {
  if (!config || typeof config !== "object") {
    throw new Error("Server configuration must be an object");
  }

  const type = (config.type as string) || "stdio";

  const knownFields = new Set<string>();

  if (type === "stdio") {
    if (!config.command || typeof config.command !== "string") {
      throw new Error("MCP server of type stdio must contain a command field");
    }

    const server: McpServerSpec = {
      type: "stdio",
      command: config.command,
    };
    knownFields.add("type");
    knownFields.add("command");

    if (config.args && Array.isArray(config.args)) {
      server.args = config.args.map((arg: any) => String(arg));
      knownFields.add("args");
    }
    if (config.env && typeof config.env === "object") {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.env)) {
        env[k] = String(v);
      }
      server.env = env;
      knownFields.add("env");
    }
    if (config.cwd && typeof config.cwd === "string") {
      server.cwd = config.cwd;
      knownFields.add("cwd");
    }

    for (const key of Object.keys(config)) {
      if (!knownFields.has(key)) {
        server[key] = config[key];
      }
    }

    return server;
  } else if (type === "http" || type === "sse") {
    if (!config.url || typeof config.url !== "string") {
      throw new Error(`${type} type of MCP server must contain a url field`);
    }

    const server: McpServerSpec = {
      type: type as "http" | "sse",
      url: config.url,
    };
    knownFields.add("type");
    knownFields.add("url");

    if (config.headers && typeof config.headers === "object") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.headers)) {
        headers[k] = String(v);
      }
      server.headers = headers;
      knownFields.add("headers");
    }

    for (const key of Object.keys(config)) {
      if (!knownFields.has(key)) {
        server[key] = config[key];
      }
    }

    return server;
  } else {
    throw new Error(`Unsupported MCP server type: ${type}`);
  }
}

export const extractIdFromToml = (tomlText: string): string => {
  try {
    const parsed = parseToml(normalizeTomlText(tomlText));

    if (parsed.mcp_servers && typeof parsed.mcp_servers === "object") {
      const serverIds = Object.keys(parsed.mcp_servers);
      if (serverIds.length > 0) {
        return serverIds[0];
      }
    }

    if (parsed.mcp && typeof parsed.mcp === "object") {
      const mcpObj = parsed.mcp as any;
      if (mcpObj.servers && typeof mcpObj.servers === "object") {
        const serverIds = Object.keys(mcpObj.servers);
        if (serverIds.length > 0) {
          return serverIds[0];
        }
      }
    }

    if (parsed.command && typeof parsed.command === "string") {
      const cmd = parsed.command.split(/[\\/]/).pop() || "";
      return cmd.replace(/\.(exe|bat|sh|js|py)$/i, "");
    }
  } catch {}

  return "";
};
