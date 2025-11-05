export interface ExplainRequest {
  prompt: string;
  cwd: string;
  base: string;
  head: string;
  includePath?: string;
}

export interface ExplainIntent {
  prompt: string;
  cwd: string;
  base: string;
  head: string;
  includePath?: string;
}

export type LineType = "context" | "add" | "remove";

export interface DiffLine {
  type: LineType;
  content: string;
  oldLineNumber?: number | null;
  newLineNumber?: number | null;
}

export interface DiffSection {
  id: string;
  filePath: string;
  header: string;
  lines: DiffLine[];
}

export interface TutorialSection {
  id: string;
  title: string;
  explanation: string;
  diffId: string;
  tags?: string[];
}

export interface ExplainResult {
  intent: ExplainIntent;
  sections: TutorialSection[];
  diffs: DiffSection[];
}
