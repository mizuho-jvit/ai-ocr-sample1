import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals を有効にしていないため、Testing Library の自動 cleanup は働かない。
// 明示的に登録しないと前のテストのDOMが残り、getBy* が複数一致で落ちる。
afterEach(() => {
  cleanup();
});
