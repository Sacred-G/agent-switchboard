export function formatJSON(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = JSON.parse(trimmed);
  return JSON.stringify(parsed, null, 2);
}

export function parseSmartMcpJson(jsonText: string): {
  id?: string;
  config: any;
  formattedConfig: string;
} {
  let trimmed = jsonText.trim();
  if (!trimmed) {
    return { config: {}, formattedConfig: "" };
  }

  if (trimmed.startsWith('"') && !trimmed.startsWith("{")) {
    trimmed = `{${trimmed}}`;
  }

  const parsed = JSON.parse(trimmed);

  const keys = Object.keys(parsed);
  if (
    keys.length === 1 &&
    parsed[keys[0]] &&
    typeof parsed[keys[0]] === "object" &&
    !Array.isArray(parsed[keys[0]])
  ) {
    const id = keys[0];
    const config = parsed[id];
    return {
      id,
      config,
      formattedConfig: JSON.stringify(config, null, 2),
    };
  }

  return {
    config: parsed,
    formattedConfig: JSON.stringify(parsed, null, 2),
  };
}
