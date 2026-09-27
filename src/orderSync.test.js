import test from "node:test";
import assert from "node:assert/strict";
import { reconcileLocalOrders, sameOrderIdentity, syncableStatus } from "./orderSync.js";

test("orders with missing client ids are not treated as identical", () => {
  assert.equal(sameOrderIdentity({ id: "one" }, { id: "two" }), false);
});

test("server settlement replaces stale local open bill and marks it settled", () => {
  const local = [{ id: "client-1", table: "edited", status: "OPEN BILL", synced: false }];
  const server = [{ id: "server-9", clientOrderId: "client-1", serverOrderId: 9, table: "original", status: "PAID", synced: true }];
  const result = reconcileLocalOrders(local, server, (order) => order.status);
  assert.equal(local[0].id, "client-1");
  assert.equal(local[0].table, "original");
  assert.equal(local[0].serverOrderId, 9);
  assert.equal(local[0].synced, true);
  assert.equal(result.settledIds.has("client-1"), true);
});

test("pending local open bill update is preserved until it can be uploaded", () => {
  const local = [{ id: "client-1", table: "edited", total: 30000, status: "OPEN BILL", synced: false }];
  const server = [{ id: "server-9", clientOrderId: "client-1", serverOrderId: 9, table: "original", total: 10000, status: "OPEN BILL", synced: true }];
  const result = reconcileLocalOrders(local, server, (order) => order.status);
  assert.equal(local[0].table, "edited");
  assert.equal(local[0].total, 30000);
  assert.equal(local[0].synced, false);
  assert.equal(result.changed, false);
});

test("synced local open bill follows the latest server snapshot", () => {
  const local = [{ id: "client-1", table: "old", total: 10000, status: "OPEN BILL", synced: true }];
  const server = [{ id: "server-9", clientOrderId: "client-1", serverOrderId: 9, table: "new", total: 30000, status: "OPEN BILL", synced: true }];
  const result = reconcileLocalOrders(local, server, (order) => order.status);
  assert.equal(local[0].table, "new");
  assert.equal(local[0].total, 30000);
  assert.equal(result.changed, true);
});

test("open bills are included in the synchronization queue", () => {
  assert.equal(syncableStatus("OPEN BILL"), true);
  assert.equal(syncableStatus("PAID"), true);
});
