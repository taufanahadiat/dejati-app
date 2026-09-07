import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const DATABASE = "dejati_pos";
let connection = null;
let opening = null;

async function database() {
  if (Capacitor.getPlatform() === "web") return null;
  if (connection) return connection;
  if (opening) return opening;

  opening = (async () => {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    try {
      connection = await sqlite.retrieveConnection(DATABASE, false);
    } catch {
      connection = await sqlite.createConnection(DATABASE, false, "no-encryption", 1, false);
    }
    await connection.open();
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS server_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, synced_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS server_catalog (id TEXT NOT NULL, cart_type TEXT NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, category TEXT NOT NULL, image TEXT, synced_at TEXT NOT NULL, PRIMARY KEY (id, cart_type));
      CREATE TABLE IF NOT EXISTS server_catalog_cache (cache_key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS server_transactions (client_order_id TEXT PRIMARY KEY NOT NULL, server_order_id INTEGER, table_number TEXT NOT NULL, payment_method TEXT NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL, synced_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS server_reports (report_date TEXT PRIMARY KEY NOT NULL, total_sales INTEGER NOT NULL, cash INTEGER NOT NULL, qris INTEGER NOT NULL, card INTEGER NOT NULL, synced_at TEXT NOT NULL);
    `);
    return connection;
  })();
  try { return await opening; } finally { opening = null; }
}

export async function initializeServerMirror() { await database(); }

export async function mirrorServerData(users, products, report, categories = []) {
  const db = await database();
  if (!db) return;
  const syncedAt = new Date().toISOString();
  await db.beginTransaction();
  try {
    await db.run("DELETE FROM server_users;", [], false);
    for (const user of users) await db.run("INSERT OR REPLACE INTO server_users (id, username, name, role, status, synced_at) VALUES (?, ?, ?, ?, ?, ?);", [user.id, user.username, user.name, user.role, user.status, syncedAt], false);
    await db.run("DELETE FROM server_catalog;", [], false);
    for (const product of products) await db.run("INSERT OR REPLACE INTO server_catalog (id, cart_type, name, price, category, image, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?);", [product.id, product.cartType || "product", product.name, product.price, product.category, product.image || null, syncedAt], false);
    await db.run("INSERT OR REPLACE INTO server_catalog_cache (cache_key, payload, synced_at) VALUES (?, ?, ?);", ["catalog", JSON.stringify({ products, categories }), syncedAt], false);
    await db.run("INSERT OR REPLACE INTO server_reports (report_date, total_sales, cash, qris, card, synced_at) VALUES (?, ?, ?, ?, ?, ?);", [report.date, report.total_sales, report.cash, report.qris, report.card, syncedAt], false);
    await db.commitTransaction();
  } catch (error) { await db.rollbackTransaction(); throw error; }
}

export async function loadServerCatalog() {
  const db = await database();
  if (!db) return null;
  const result = await db.query("SELECT payload FROM server_catalog_cache WHERE cache_key = ?;", ["catalog"]);
  const payload = result.values?.[0]?.payload;
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

export async function mirrorReportHistory(history) {
  const db = await database();
  if (!db) return;
  await db.run("INSERT OR REPLACE INTO server_catalog_cache (cache_key, payload, synced_at) VALUES (?, ?, ?);", ["report-history", JSON.stringify(history), new Date().toISOString()]);
}

export async function loadReportHistory() {
  const db = await database();
  if (!db) return null;
  const result = await db.query("SELECT payload FROM server_catalog_cache WHERE cache_key = ?;", ["report-history"]);
  try { return JSON.parse(result.values?.[0]?.payload || "null"); } catch { return null; }
}

export async function mirrorServerTransaction(order, serverOrderId) {
  const db = await database();
  if (!db) return;
  await db.run("INSERT OR REPLACE INTO server_transactions (client_order_id, server_order_id, table_number, payment_method, total, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?);", [order.id, serverOrderId || null, order.table, order.method, order.total, order.created, new Date().toISOString()]);
}
