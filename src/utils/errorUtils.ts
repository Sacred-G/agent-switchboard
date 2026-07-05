export const extractErrorMessage = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object") {
    const errObject = error as Record<string, unknown>;

    const candidate = errObject.message ?? errObject.error ?? errObject.detail;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }

    const payload = errObject.payload;
    if (typeof payload === "string" && payload.trim()) {
      return payload;
    }
    if (payload && typeof payload === "object") {
      const payloadObj = payload as Record<string, unknown>;
      const payloadCandidate =
        payloadObj.message ?? payloadObj.error ?? payloadObj.detail;
      if (typeof payloadCandidate === "string" && payloadCandidate.trim()) {
        return payloadCandidate;
      }
    }
  }

  return "";
};

export const translateMcpBackendError = (
  message: string,
  t: (key: string, opts?: any) => string,
): string => {
  if (!message) return "";
  const msg = String(message).trim();

  if (msg.includes("MCP server ID cannot be empty")) {
    return t("mcp.error.idRequired");
  }
  if (
    msg.includes("MCP server definition must be a JSON object") ||
    msg.includes("MCP server entry must be a JSON object") ||
    msg.includes("MCP server entry is missing server field") ||
    msg.includes("MCP server server field must be a JSON object") ||
    msg.includes("MCP server connection definition must be a JSON object") ||
    msg.includes("MCP server '") ||
    msg.includes("is not an object") ||
    msg.includes("Server configuration must be an object") ||
    msg.includes("MCP server name must be a string") ||
    msg.includes("MCP server description must be a string") ||
    msg.includes("MCP server homepage must be a string") ||
    msg.includes("MCP server docs must be a string") ||
    msg.includes("MCP server tags must be a string array") ||
    msg.includes("MCP server enabled must be a boolean")
  ) {
    return t("mcp.error.jsonInvalid");
  }
  if (msg.includes("MCP server type must be")) {
    return t("mcp.error.jsonInvalid");
  }

  if (
    msg.includes("stdio type MCP server is missing command field") ||
    msg.includes("must contain command field")
  ) {
    return t("mcp.error.commandRequired");
  }
  if (
    msg.includes("http type MCP server is missing url field") ||
    msg.includes("sse type MCP server is missing url field") ||
    msg.includes("must contain url field") ||
    msg === "URL cannot be empty"
  ) {
    return t("mcp.wizard.urlRequired");
  }

  if (
    msg.includes("Failed to parse ~/.claude.json") ||
    msg.includes("Failed to parse config.toml") ||
    msg.includes("Unrecognized TOML format") ||
    msg.includes("TOML content cannot be empty")
  ) {
    return t("mcp.error.tomlInvalid");
  }
  if (msg.includes("Failed to serialize config.toml")) {
    return t("mcp.error.tomlInvalid");
  }

  return "";
};
