import { expect, it } from "vitest";
import { operationsPage } from "../apps/desktop/src/renderer/operations-center-ui";

it("keeps all 5000 publish records reachable without rendering the full history and filters before paging", () => {
  const rows = Array.from({ length: 5000 }, (_, id) => ({ id, ownerActionRequired: id === 4999 }));
  const before = JSON.stringify(rows);
  const reached: number[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = operationsPage(rows, page);
    expect(result.items.length).toBeLessThanOrEqual(50);
    reached.push(...result.items.map(row => row.id));
  }
  expect(reached).toEqual(rows.map(row => row.id));
  const filtered = operationsPage(rows.filter(row => row.ownerActionRequired), 100);
  expect(filtered).toMatchObject({ page: 1, total: 1, pages: 1, items: [{ id: 4999 }] });
  expect(operationsPage([], 100)).toMatchObject({ page: 1, pages: 1, total: 0, items: [] });
  expect(JSON.stringify(rows)).toBe(before);
});
