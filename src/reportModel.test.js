import test from "node:test";
import assert from "node:assert/strict";
import { orderStatus, jakartaDate, dateRange, closingRecords, validateExpenses, localClosing } from "./reportModel.js";

test("local closing includes paid orders on the Jakarta date and expenses", () => {
  const orders = [
    { createdAt: "2026-09-20T10:00:00Z", status: "PAID", method: "cash", total: 20000, items: [{ cartType: "product", price: 20000, qty: 1 }] },
    { createdAt: "2026-09-20T12:00:00Z", status: "PAID", method: "qris", total: 15000, items: [{ cartType: "carwash", price: 15000, qty: 1 }] },
    { createdAt: "2026-09-20T18:00:00Z", status: "PAID", method: "cash", total: 9000 },
    { createdAt: "2026-09-20T10:00:00Z", status: "CANCEL", method: "cash", total: 5000 },
  ];
  const result = localClosing(orders, "2026-09-20", [{ keterangan: "Es", total: 3000 }]);
  assert.equal(result.total_penjualan, 35000);
  assert.equal(result.cash, 20000);
  assert.equal(result.qris, 15000);
  assert.equal(result.cafe, 20000);
  assert.equal(result.carwash, 15000);
  assert.equal(result.net, 32000);
});

test("explicit status overrides paid amount, including free paid orders and canceled payments", () => {
  assert.equal(orderStatus({status:"CANCEL",paid:50000}),"CANCEL");
  assert.equal(orderStatus({status:"PAID",paid:0}),"PAID");
  assert.equal(orderStatus({paid:0}),"OPEN BILL");
  assert.equal(orderStatus({paid:10}),"PAID");
});
test("report date uses Jakarta across UTC midnight and week/month boundaries", () => {
  assert.equal(jakartaDate("2026-09-05T18:00:00Z"),"2026-09-06");
  assert.deepEqual(dateRange("week",new Date("2026-09-06T10:00:00Z")),{start:"2026-08-31",end:"2026-09-06"});
  assert.deepEqual(dateRange("month",new Date("2024-02-15T00:00:00Z")),{start:"2024-02-01",end:"2024-02-29"});
});
test("closing history keeps latest snapshot and filters month and year independently", () => {
  const rows=[{id:1,tanggal:"2025-09-05"},{id:2,tanggal:"2026-09-05"},{id:3,tanggal:"2026-09-05"},{id:4,tanggal:"2026-08-05"}];
  assert.deepEqual(closingRecords(rows,"09","2026").map(r=>r.id),[3]);
  assert.deepEqual(closingRecords(rows,"09").map(r=>r.id),[3,1]);
});
test("expenses permit empty submission but reject partial, fractional, negative, and overflow values", () => {
  assert.deepEqual(validateExpenses([{keterangan:" ",total:""}]),[]);
  assert.deepEqual(validateExpenses([{keterangan:" Es ",total:"10000"}]),[{keterangan:"Es",total:10000}]);
  for(const row of [{keterangan:"Es",total:""},{keterangan:"",total:10},{keterangan:"Es",total:1.5},{keterangan:"Es",total:-1},{keterangan:"Es",total:2147483648}]) assert.throws(()=>validateExpenses([row]));
});
