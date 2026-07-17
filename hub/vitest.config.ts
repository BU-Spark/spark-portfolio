import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Don't scan node_modules, the Next build, or temporary agent worktrees
    // (.claude/worktrees holds repo checkouts whose *.test.ts would double-run).
    exclude: ["node_modules/**", ".next/**", ".claude/**", "dist/**"],
  },
});
