import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Predicate from "effect/Predicate";

import { createAttachmentId, resolveAttachmentPath } from "../../attachmentStore.ts";
import { inferImageExtension } from "../../imageMime.ts";

/** Saves tool images before Claude continues, and replaces their bytes in client events. */
export const persistClaudeToolImages = Effect.fn("persistClaudeToolImages")(function* (input: {
  readonly content: unknown;
  readonly threadId: string;
  readonly attachmentsDir: string;
  readonly savedPaths?: ReadonlyArray<string | null> | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const blocks: ReadonlyArray<unknown> = Array.isArray(input.content)
    ? input.content
    : Predicate.isObject(input.content) && Array.isArray(input.content.content)
      ? input.content.content
      : [];
  const clientBlocks: unknown[] = [];
  const modelBlocks: unknown[] = [];
  const savedPaths: Array<string | null> = [];
  for (const block of blocks) {
    if (!Predicate.isObject(block) || block.type !== "image") {
      clientBlocks.push(block);
      modelBlocks.push(block);
      continue;
    }
    const source = Predicate.isObject(block.source) ? block.source : block;
    const mimeType = source.media_type ?? source.mimeType;
    if (typeof source.data !== "string" || typeof mimeType !== "string") {
      clientBlocks.push(block);
      modelBlocks.push(block);
      continue;
    }
    const data = source.data;
    const previousPath = input.savedPaths?.[savedPaths.length];
    const savedPath =
      previousPath !== undefined
        ? previousPath
        : yield* Effect.gen(function* () {
            const id = createAttachmentId(input.threadId);
            if (!id) return null;
            const bytes = Buffer.from(data, "base64");
            const filePath = resolveAttachmentPath({
              attachmentsDir: input.attachmentsDir,
              attachment: {
                type: "image",
                id,
                name: `tool-image${inferImageExtension({ mimeType })}`,
                mimeType,
                sizeBytes: bytes.length,
              },
            });
            if (!filePath) return null;
            yield* fs.makeDirectory(input.attachmentsDir, { recursive: true });
            yield* fs.writeFile(filePath, bytes);
            return filePath;
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to save Claude tool image.", { cause }).pipe(
                Effect.as(null),
              ),
            ),
          );
    savedPaths.push(savedPath);
    const text = {
      type: "text",
      text: savedPath ? `Image saved to: ${savedPath}` : "Could not save tool image.",
    };
    const alreadyHasPath = blocks.some(
      (entry) => Predicate.isObject(entry) && entry.type === "text" && entry.text === text.text,
    );
    if (!alreadyHasPath) clientBlocks.push(text);
    modelBlocks.push(block);
    if (!alreadyHasPath) modelBlocks.push(text);
  }
  const withBlocks = (content: unknown[]) =>
    Array.isArray(input.content)
      ? content
      : Predicate.isObject(input.content) && Array.isArray(input.content.content)
        ? { ...input.content, content }
        : input.content;
  return {
    content: withBlocks(clientBlocks),
    modelContent: withBlocks(modelBlocks),
    savedPaths,
    imagePaths: savedPaths.filter((filePath) => filePath !== null),
  };
});
