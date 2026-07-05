import { z } from "zod";

function parseJsonError(error: unknown): string {
  if (!(error instanceof SyntaxError)) {
    return "Configure JSON format error";
  }

  const message = error.message;

  const positionMatch = message.match(/at position (\d+)/i);
  if (positionMatch) {
    const position = parseInt(positionMatch[1], 10);
    return `JSON format error: ${message.split(" in JSON")[0]} (position: ${position})`;
  }

  // Firefox: "JSON.parse: unexpected character at line 1 column 23"
  const lineColumnMatch = message.match(/line (\d+) column (\d+)/i);
  if (lineColumnMatch) {
    const line = lineColumnMatch[1];
    const column = lineColumnMatch[2];
    return `JSON format error: line ${line}, column ${column}`;
  }

  const cleanMessage = message
    .replace(/^JSON\.parse:\s*/i, "")
    .replace(/^Unexpected\s+/i, "Unexpected ")
    .replace(/token/gi, "token")
    .replace(/Expected/gi, "Expected");

  return `JSON format error: ${cleanMessage}`;
}

export const providerSchema = z.object({
  name: z.string(),
  websiteUrl: z
    .string()
    .url("Please enter a valid website URL")
    .optional()
    .or(z.literal("")),
  notes: z.string().optional(),
  settingsConfig: z
    .string()
    .min(1, "Please fill in the configuration content")
    .superRefine((value, ctx) => {
      try {
        JSON.parse(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: parseJsonError(error),
        });
      }
    }),
  icon: z.string().optional(),
  iconColor: z.string().optional(),
});

export type ProviderFormData = z.infer<typeof providerSchema>;
