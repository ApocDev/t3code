import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { persistClaudeToolImages } from "./ClaudeToolImages.ts";

it.effect("saves transcript-format images when no hook paths are available", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const attachmentsDir = yield* fs.makeTempDirectoryScoped();
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AQIDBA==" },
    };
    const result = yield* persistClaudeToolImages({
      content: [image],
      threadId: "thread-1",
      attachmentsDir,
    });
    assert.equal(result.imagePaths.length, 1);
    const filePath = result.imagePaths[0]!;
    assert.isTrue(filePath.endsWith(".jpg"));
    assert.deepEqual(yield* fs.readFile(filePath), new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(result.content, [{ type: "text", text: `Image saved to: ${filePath}` }]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps images available to Claude and reports a failed save without inventing paths",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const attachmentsDir = path.join(directory, "not-a-directory");
      yield* fs.writeFileString(attachmentsDir, "occupied");
      const image = { type: "image", data: "AQIDBA==", mimeType: "image/png" };
      const result = yield* persistClaudeToolImages({
        content: [image],
        threadId: "thread-1",
        attachmentsDir,
      });
      assert.deepEqual(result.imagePaths, []);
      assert.deepEqual(result.content, [{ type: "text", text: "Could not save tool image." }]);
      assert.deepEqual(result.modelContent, [
        image,
        { type: "text", text: "Could not save tool image." },
      ]);
      assert.deepEqual(yield* fs.readDirectory(directory), ["not-a-directory"]);
    }).pipe(Effect.provide(NodeServices.layer)),
);
