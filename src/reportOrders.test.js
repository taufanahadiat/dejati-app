import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReportOrders } from "./reportOrders.js";

test("server revenue is visible on a device with no local transactions", () => {
  const server = [{ serverOrderId: 1, total: 286000 }];
  assert.equal(mergeReportOrders(server, []).reduce((sum, order) => sum + order.total, 0), 286000);
});

test("uploaded orders count once, including retries after a lost response", () => {
  const server = [{ serverOrderId: 1, clientOrderId: "local-1", total: 286000 }];
  const local = [{ id: "local-1", synced: false, total: 286000 }, { id: "pending", total: 10000 }];
  assert.equal(mergeReportOrders(server, local).reduce((sum, order) => sum + order.total, 0), 296000);
  assert.equal(mergeReportOrders(server, [{ id: "legacy", serverOrderId: 1 }]).length, 1);
});

test("local edits override the matching server order", () => {
  const server = [{ serverOrderId: 1, clientOrderId: "bill-1", total: 25000, items: [{ name: "A" }] }];
  const local = [{ id: "bill-1", serverOrderId: 1, total: 40000, items: [{ name: "A" }, { name: "B" }] }];
  const merged = mergeReportOrders(server, local);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].total, 40000);
  assert.equal(merged[0].items.length, 2);
});

test("offline and pre-migration data remain available", () => {
  const local = [{ id: "pending", total: 10000 }];
  assert.deepEqual(mergeReportOrders(null, local), local);
  assert.deepEqual(mergeReportOrders([], local), local);
});
