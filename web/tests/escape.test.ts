import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CandleDetail } from "../src/panels/Panels";

describe("wish rendering", () => {
  it("renders HTML in a wish as inert text", () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(CandleDetail, {
      c: { id: 3, purchaser: "0x1111111111111111111111111111111111111111", style: 2, createdAt: 1731800000, position: 2, wish: '<img src=x onerror="alert(1)"><script>alert(2)</script>' },
      onClose: () => {}, mine: false,
    })));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;");
  });
});
