import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, CLAUDE_MODEL } from "@/lib/claude";

const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function toMediaType(mimeType: string): SupportedMediaType {
  return (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mimeType)
    ? (mimeType as SupportedMediaType)
    : "image/jpeg";
}

/**
 * Builds Claude content blocks (image or PDF document) from uploaded files,
 * for attaching alongside a text prompt in a single multimodal message —
 * shared by anything that lets a tech attach photos/plans as generation
 * input, not just single-field extraction.
 */
export async function buildFileContentBlocks(
  files: File[]
): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const file of files) {
    if (!file || file.size === 0) continue;
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    if (file.type === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else {
      blocks.push({ type: "image", source: { type: "base64", media_type: toMediaType(file.type), data } });
    }
  }
  return blocks;
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
