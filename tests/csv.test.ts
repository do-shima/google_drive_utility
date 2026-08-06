import { describe, expect, it } from "vitest";
import { createDriveCsv } from "@/lib/csv";

describe("CSV output", () => {
  it("escapes quotes, commas, newlines and spreadsheet formulas", () => {
    const csv = createDriveCsv([{ mimeType: "text/plain", name: '=IMPORTXML("x", "y"),\nnext', webViewLink: "+https://example.test" }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=IMPORTXML(""x"", ""y""),\nnext"');
    expect(csv).toContain('"\'+https://example.test"');
    expect(csv).toContain("\r\n");
  });
});
