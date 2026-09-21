export function orderStatus(order) {
  const explicit = String(order.status || order.status_order || "").trim().toUpperCase().replaceAll("_", " ");
  return explicit || (Number(order.paid) === 0 ? "OPEN BILL" : "PAID");
}

export function jakartaDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function dateRange(preset, now = new Date()) {
  const end = jakartaDate(now);
  const date = new Date(`${end}T12:00:00Z`);
  if (preset === "week") {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const start = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { start, end: date.toISOString().slice(0, 10) };
  }
  if (preset === "month") {
    const start = `${end.slice(0, 7)}-01`;
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return { start, end: date.toISOString().slice(0, 10) };
  }
  return { start: end, end };
}

export function closingRecords(records = [], month = "", year = "") {
  const latest = new Map();
  for (const row of records) {
    if ((!month || row.tanggal.slice(5, 7) === month) && (!year || row.tanggal.slice(0, 4) === year)) {
      if (!latest.has(row.tanggal) || Number(row.id) > Number(latest.get(row.tanggal).id)) latest.set(row.tanggal, row);
    }
  }
  return [...latest.values()].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

export function validateExpenses(rows) {
  return rows.filter(row => row.keterangan.trim() || String(row.total).trim()).map(row => {
    const keterangan = row.keterangan.trim();
    const total = Number(row.total);
    if (!keterangan || new TextEncoder().encode(keterangan).length > 255 || !Number.isSafeInteger(total) || total <= 0 || total > 2147483647) {
      throw new Error("Lengkapi keterangan (maksimal 255 byte) dan nominal pengeluaran berupa bilangan bulat positif.");
    }
    return { keterangan, total };
  });
}

export function localClosing(orders, date, expenses = []) {
  const paid = orders.filter(o => jakartaDate(o.createdAt) === date && orderStatus(o) === "PAID");
  const sum = rows => rows.reduce((total, row) => total + Number(row.total || 0), 0);
  const amount = method => sum(paid.filter(o => o.method === method));
  const category = type => paid.reduce((total, order) => total + (order.items || []).filter(item => (item.cartType || "product") === type).reduce((n, item) => n + Number(item.lineTotal ?? item.price * item.qty), 0), 0);
  const total_penjualan = sum(paid);
  const total_expenses = sum(expenses);
  return { tanggal: date, total_penjualan, cash: amount("cash"), qris: amount("qris"), card: amount("credit_card"), cafe: category("product"), carwash: category("carwash"), expenses, total_expenses, net: total_penjualan - total_expenses };
}
