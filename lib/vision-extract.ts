import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { claude, CLAUDE_MODEL } from "@/lib/claude";

const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function toMediaType(mimeType: string): SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mimeType)
    ? (mimeType as SupportedMediaType)
    : "image/jpeg";
}

export async function extractFromImage<T extends z.ZodTypeAny>(
  file: File,
  schema: T,
  systemPrompt: string
): Promise<z.infer<T>> {
  const buffer = Buffer.from(await file.arrayBuffer());

  const response = await claude.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: toMediaType(file.type),
              data: buffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: "Extract the fields you can confidently read from this photo. Leave anything not legible or not shown as null.",
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(schema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Could not read that photo clearly. Try a closer, well-lit shot.");
  }
  return parsed;
}
