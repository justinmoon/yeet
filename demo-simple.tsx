#!/usr/bin/env bun
// Set tree-sitter worker path before importing opentui
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(
  __dirname,
  "node_modules/@opentui/core/parser.worker.js",
);
process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;

import {
  addDefaultParsers,
  SyntaxStyle,
  RGBA,
  getTreeSitterClient,
} from "@opentui/core";
import { render, useRenderer } from "@opentui/solid";

// Initialize built-in parsers (markdown, JS, TS) - MUST be at module level
addDefaultParsers([]);

// Wait for tree-sitter client to initialize
const client = getTreeSitterClient();
await client.initialize();
console.log("Tree-sitter client initialized");

const MARKDOWN_SAMPLE = `# Sample Markdown Document

A comprehensive demo of **markdown rendering** with *syntax highlighting*.

## Text Formatting

You can make text **bold** or *italic*. You can also combine them for ***bold and italic*** text. Use ~~strikethrough~~ for deleted text.

For code, use \`inline code\` like \`const x = 42\` or create code blocks:

\`\`\`python
def hello_world():
    print("Hello, World!")
    return True
\`\`\`

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}
\`\`\`

## Lists

### Unordered List
- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3 with **bold** and *italic*

### Ordered List
1. First item
2. Second item with \`code\`
3. Third item

### Task List
- [ ] Uncompleted task
- [x] Completed task
- [ ] Another task with **bold**
- [x] Done with ~~strikethrough~~

## Links and References

Check out [OpenTUI](https://opentui.dev) for the rendering library.

You can also write [links with **bold**](https://github.com) or visit https://example.com directly.

Read the [documentation](https://docs.example.com/guide) for more info.

## Blockquotes

> This is a blockquote.
> It can span multiple lines.

> You can also have **bold** and *italic* text in blockquotes.
> Even \`code\` works here!

## Mixed Content

Here's a paragraph with **bold**, *italic*, \`inline code\`, and a [link](https://test.com) all together!

### Code with Comments

\`\`\`typescript
// Define an interface
interface User {
  name: string;
  age: number;
}

const user: User = { name: "Alice", age: 30 };
\`\`\`
`;

render(
  () => {
    const renderer = useRenderer();

    // Create syntax style with basic colors
    const syntaxStyle = SyntaxStyle.fromTheme([
      {
        scope: [
          "markup.heading",
          "markup.heading.1",
          "markup.heading.2",
          "markup.heading.3",
          "markup.heading.4",
        ],
        style: {
          foreground: RGBA.fromHex("#7aa2f7"),
          bold: true,
        },
      },
      {
        scope: ["markup.bold", "markup.strong"],
        style: {
          foreground: RGBA.fromHex("#ff9e64"),
          bold: true,
        },
      },
      {
        scope: ["markup.italic"],
        style: {
          foreground: RGBA.fromHex("#bb9af7"),
          italic: true,
        },
      },
      {
        scope: ["markup.strikethrough"],
        style: {
          foreground: RGBA.fromHex("#565f89"), // Dim gray
          strikethrough: true,
        },
      },
      {
        scope: ["markup.raw", "markup.raw.inline"],
        style: {
          foreground: RGBA.fromHex("#9ece6a"),
        },
      },
      {
        scope: ["markup.raw.block"],
        style: {
          foreground: RGBA.fromHex("#9ece6a"),
        },
      },
      {
        scope: ["string"],
        style: {
          foreground: RGBA.fromHex("#9ece6a"),
        },
      },
      {
        scope: ["keyword"],
        style: {
          foreground: RGBA.fromHex("#bb9af7"),
          italic: true,
        },
      },
      {
        scope: ["function"],
        style: {
          foreground: RGBA.fromHex("#7aa2f7"),
        },
      },
      // Links
      {
        scope: ["markup.link", "markup.link.label"],
        style: {
          foreground: RGBA.fromHex("#7aa2f7"),
          underline: true,
        },
      },
      {
        scope: ["markup.link.url"],
        style: {
          foreground: RGBA.fromHex("#7dcfff"), // Cyan for URLs
          underline: true,
        },
      },
      {
        scope: ["markup.link.bracket.close"],
        style: {
          foreground: RGBA.fromHex("#7aa2f7"),
        },
      },
      // Blockquotes
      {
        scope: ["markup.quote"],
        style: {
          foreground: RGBA.fromHex("#565f89"), // Dim gray
          italic: true,
        },
      },
      {
        scope: ["punctuation.special"],
        style: {
          foreground: RGBA.fromHex("#565f89"), // Dim gray
        },
      },
      // Lists
      {
        scope: ["markup.list"],
        style: {
          foreground: RGBA.fromHex("#9ece6a"), // Green
        },
      },
      {
        scope: ["markup.list.checked"],
        style: {
          foreground: RGBA.fromHex("#9ece6a"), // Green for completed
        },
      },
      {
        scope: ["markup.list.unchecked"],
        style: {
          foreground: RGBA.fromHex("#565f89"), // Dim gray for incomplete
        },
      },
    ]);

    renderer.setBackgroundColor("#1a1b26");

    return (
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        <box style={{ backgroundColor: "#DCDCDC", height: 1 }}>
          <text style={{ fg: "#000000" }}>Markdown Demo</text>
        </box>

        <box style={{ height: 1 }}>
          <text> </text>
        </box>

        <scrollbox style={{ flexGrow: 1 }}>
          <box paddingLeft={3} marginTop={1} flexShrink={0}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              syntaxStyle={syntaxStyle}
              content={MARKDOWN_SAMPLE}
              conceal={true}
            />
          </box>
        </scrollbox>

        <box style={{ height: 1 }}>
          <text> </text>
        </box>

        <box style={{ backgroundColor: "#DCDCDC", height: 1 }}>
          <text style={{ fg: "#000000" }}>Press Ctrl+C to exit</text>
        </box>
      </box>
    );
  },
  {
    exitOnCtrlC: true,
    targetFps: 30,
  },
);
