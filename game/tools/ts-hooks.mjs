// Loads the client's TypeScript directly in Node (Node strips the types): the resolve hook adds the `.ts` the sources
// leave out of their imports. Shared by the Node measurement tools (bench-plan.mjs).
import { registerHooks } from "node:module";

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (!spec.startsWith(".")) throw e;
      for (const ext of [".ts", "/index.ts"])
        try {
          return next(spec + ext, ctx);
        } catch {
          /* the next */
        }
      throw e;
    }
  },
  // (The package has no "type": the sources are ES modules.)
  load: (url, ctx, next) => next(url, url.endsWith(".ts") ? { ...ctx, format: "module-typescript" } : ctx),
});
