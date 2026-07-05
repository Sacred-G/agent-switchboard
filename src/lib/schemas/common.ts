import { z } from "zod";
import { validateToml, tomlToMcpServer } from "@/utils/tomlUtils";

function parseJsonError(error: unknown): string {
  if (!(error instanceof SyntaxError)) {
    return "JSON format error";
  }

  const message = error.message || "JSON parsing failed";

  // Chrome/V8: "Unexpected token ... in JSON at position 123"
  const positionMatch = message.match(/at position (\d+)/i);
  if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    return `JSON format error (position: ${position})`;
  }

  // Firefox: "JSON.parse: unexpected character at line 1 column 23"
  const lineColumnMatch = message.match(/line (\d+) column (\d+)/i);
  if (lineColumnMatch) {
    const line = lineColumnMatch[1];
    const column = lineColumnMatch[2];
    return `JSON format error: line ${line}, column ${column}`;
  }

  return `JSON format error: ${message}`;
}

export const jsonConfigSchema = z
  .string()
  .min(1, "Configuration cannot be empty")
  .superRefine((value, ctx) => {
    try {
      const obj = JSON.parse(value);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must be configured as a single object",
        });
      }
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: parseJsonError(e),
      });
    }
  });

export const tomlConfigSchema = z.string().superRefine((value, ctx) => {
  const err = validateToml(value);
  if (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid TOML: ${err}`,
    });
    return;
  }

  if (!value.trim()) return;

  try {
    const server = tomlToMcpServer(value);
    if (server.type === "stdio" && !server.command?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "command is required for stdio type",
      });
    }
    if (
      (server.type === "http" || server.type === "sse") &&
      !server.url?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${server.type} url is required for type`,
      });
    }
  } catch (e: any) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e?.message || "TOML parsing failed",
    });
  }
});
