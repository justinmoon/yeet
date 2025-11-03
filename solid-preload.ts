import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import { type BunPlugin, plugin } from "bun";

const solidTransformPlugin: BunPlugin = {
  name: "bun-plugin-solid",
  setup: (build) => {
    // Handle solid-js server.js imports by redirecting to solid.js
    build.onLoad(
      { filter: /\/node_modules\/solid-js\/dist\/server\.js$/ },
      async (args) => {
        const path = args.path.replace("server.js", "solid.js");
        const file = Bun.file(path);
        const code = await file.text();
        return { contents: code, loader: "js" };
      },
    );

    build.onLoad(
      { filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ },
      async (args) => {
        const path = args.path.replace("server.js", "store.js");
        const file = Bun.file(path);
        const code = await file.text();
        return { contents: code, loader: "js" };
      },
    );

    // Transform JSX/TSX files with Babel and babel-preset-solid
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const file = Bun.file(args.path);
      const code = await file.text();
      const transforms = await transformAsync(code, {
        filename: args.path,
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid",
              generate: "universal",
            },
          ],
          [ts],
        ],
      });
      return {
        contents: transforms?.code ?? "",
        loader: "js",
      };
    });
  },
};

plugin(solidTransformPlugin);
