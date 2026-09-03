import type { BunPlugin } from "bun";

import { compileView } from "./compiler.ts";
import { injectContent } from "./content.ts";

export const viewPlugin: BunPlugin = {
  name: "luon-view",
  setup(build) {
    build.onLoad({
      filter: /(?:[/\\]app[/\\].+|\.view)\.tsx$/,
    }, async (args) => {
      const source = await Bun.file(args.path).text();
      const editor = process.env.LUON_EDITOR === "1"
        || process.env.LUON_EDITOR_PREVIEW === "1";
      const input = editor
        ? injectContent(args.path, source)
        : source;
      const result = compileView(input, { id: args.path });
      return { contents: result.code, loader: "js" };
    });
  },
};

export default viewPlugin;
