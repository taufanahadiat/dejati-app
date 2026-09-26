import { createReports } from "./reports.js";
import { orderStatus } from "./reportModel.js";
import { mergeReportOrders } from "./reportOrders.js";
import {
  initializeServerMirror,
  loadServerCatalog,
  loadReportHistory,
  mirrorReportHistory,
  mirrorServerData,
  mirrorServerTransaction,
} from "./posDatabase.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import "./app.css";

const API = "https://pos.dejaticoffee.com/api/mobile";
const app = document.querySelector("#app");
const BluetoothSerial = registerPlugin("BluetoothSerial");

const state = {
  session: read("dejati-session", null),
  products: read("dejati-products", []),
  categories: read("dejati-categories", []),
  cart: read("dejati-cart", []),
  orders: read("dejati-orders", []),
  serverHistory: read("dejati-server-history", null),
  activeBill: read("dejati-active-bill", null),
  historyDrawerOpen: false,
  page: "dashboard",
  category: "all",
  search: "",
  table: "",
  sidebarOpen: false,
  navbarMenu: "",
  syncing: false,
  modal: null,
  selected: null,
  editing: null,
  dashboardRange: "month",
  reportMonth: "",
  reportDate: "",
  printers: read("dejati-printers", { cashier: null, kitchen: null }),
  printerDevices: [],
  printerTarget: "cashier",
  printerLoading: false,
  theme:
    localStorage.getItem("adminlte-theme-mode") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
};
const reports = createReports({
  state, orders: reportingOrders, api, render, persist, notice,
  loadOpenBill: loadOpenBillForCheckout,
  money, esc, printReceipt,
  refresh: async () => {
    if (state.syncing) throw new Error("Sinkronisasi sedang berjalan. Coba kembali sebentar lagi.");
    await sync(true, true);
    const history = await api("report-history", state.session.token);
    state.serverHistory = history;
    persist();
    await mirrorReportHistory(history);
  },
  connectCashier: async () => {
    await ensureBluetoothReady();
    const printer = state.printers.cashier;
    if (!printer?.address) throw new Error("Pilih printer kasir melalui menu Printer terlebih dahulu.");
    await BluetoothSerial.connect({ address: printer.address });
  },
  printText: async (text) => {
    try { await BluetoothSerial.write({ data: toBase64(text) }); await wait(900); }
    finally { await BluetoothSerial.disconnect().catch(() => undefined); }
  },
});
if (localStorage.getItem("dejati-catalog-source") !== "sqlite-sync") {
  state.products = [];
  state.categories = [];
  localStorage.removeItem("dejati-products");
  localStorage.removeItem("dejati-categories");
  localStorage.setItem("dejati-catalog-source", "sqlite-sync");
}
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function persist() {
  if (state.serverHistory) localStorage.setItem("dejati-server-history", JSON.stringify(state.serverHistory));
  localStorage.setItem("dejati-products", JSON.stringify(state.products));
  localStorage.setItem("dejati-categories", JSON.stringify(state.categories));
  localStorage.setItem("dejati-cart", JSON.stringify(state.cart));
  localStorage.setItem("dejati-orders", JSON.stringify(state.orders));
  localStorage.setItem("dejati-printers", JSON.stringify(state.printers));
  if (state.activeBill)
    localStorage.setItem("dejati-active-bill", JSON.stringify(state.activeBill));
  else localStorage.removeItem("dejati-active-bill");
  if (state.session)
    localStorage.setItem("dejati-session", JSON.stringify(state.session));
  else localStorage.removeItem("dejati-session");
}
function money(value) {
  return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}
function formatDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("id-ID") : "";
}
function isNativeApp() {
  return Capacitor.isNativePlatform();
}
function printerName(type) {
  const printer = state.printers[type];
  if (!printer?.address) return "not connected";
  const suffix = String(printer.address).slice(-5);
  return `${printer.name || "Printer"} ${suffix}`;
}
function navbarPrinterButton(type, icon, label) {
  const connected = Boolean(state.printers[type]?.address);
  const action = type === "cashier" ? "connect-cashier" : "connect-kitchen";
  const id = type === "cashier" ? "navbarConnectCashierPrinter" : "navbarConnectKitchenPrinter";
  return `<button type="button" id="${id}" class="dropdown-item d-flex align-items-center justify-content-between ${connected ? "printer-connected" : ""}" data-action="${action}" title="${esc(printerName(type))}"><span><i class="fas ${icon} mr-2"></i>${label}</span>${connected ? `<i class="fas fa-check ml-3" aria-label="Connected"></i>` : ""}</button>`;
}
function receiptLine(left, right = "") {
  const width = 32;
  const start = String(left);
  const end = String(right);
  if (!end) return start;
  if (start.length + end.length + 1 > width)
    return `${start.slice(0, width - end.length - 1)} ${end}`;
  return `${start}${" ".repeat(width - start.length - end.length)}${end}`;
}
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function sweetConfirm({ title, text, icon = "warning", confirmButtonText = "Ya", cancelButtonText = "Batal", confirmButtonColor = "#dc3545" }) {
  if (!window.Swal) return confirm(text || title);
  const result = await window.Swal.fire({
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor,
    reverseButtons: true,
  });
  return result.isConfirmed;
}
async function sweetTextarea({ title, text, placeholder = "", confirmButtonText = "Ya", cancelButtonText = "Batal" }) {
  if (!window.Swal) {
    const value = prompt(text || title);
    return value === null ? null : value;
  }
  const result = await window.Swal.fire({
    title,
    text,
    input: "textarea",
    inputPlaceholder: placeholder,
    inputAttributes: { maxlength: 5000 },
    icon: "warning",
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText,
    confirmButtonColor: "#dc3545",
    reverseButtons: true,
    inputValidator: (value) => (!value.trim() ? "Alasan cancel wajib diisi." : undefined),
  });
  return result.isConfirmed ? result.value : null;
}
function receiptText(order) {
  const date = orderDate(order).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  const items = order.items.flatMap((item) => [
    `${item.qty}x ${String(item.name).slice(0, 28)}`,
    receiptLine("", money(item.price * item.qty)),
    ...(item.notes ? [`  ${String(item.notes).slice(0, 29)}`] : []),
  ]);
  return [
    "\x1B\x40\x1B\x61\x01", "DE'JATI COFFEE GARDEN", "& CARWASH", "\x1B\x61\x00",
    "--------------------------------", receiptLine("Meja", order.table), receiptLine("Waktu", date),
    receiptLine("Bayar", String(order.method).replace("_", " ")), "--------------------------------",
    ...items, "--------------------------------", receiptLine("Subtotal", money(order.subtotal)),
    ...(order.discount ? [receiptLine("Diskon", `-${money(order.discount)}`)] : []),
    receiptLine("TOTAL", money(order.total)),
    ...(order.method === "cash" ? [receiptLine("Bayar", money(order.paid)), receiptLine("Kembali", money(order.change))] : []),
    "\x1B\x61\x01", "Terima kasih", "\n\n\n\n",
  ].join("\n");
}
function kitchenReceiptText(order) {
  const date = orderDate(order).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
  const items = order.items.flatMap((item) => [
    `${item.qty}x ${String(item.name).slice(0, 28)}`,
    ...(item.notes ? [`  ${String(item.notes).slice(0, 29)}`] : []),
  ]);
  return [
    "\x1B\x40\x1B\x61\x01", "KITCHEN ORDER", "DE'JATI COFFEE GARDEN", "\x1B\x61\x00",
    "--------------------------------", receiptLine("Meja", order.table), receiptLine("Waktu", date),
    "--------------------------------", ...items, "--------------------------------", "\n\n\n\n",
  ].join("\n");
}
async function ensureBluetoothReady() {
  if (!isNativeApp()) throw new Error("Bluetooth printer hanya tersedia di APK Android.");
  const permission = await BluetoothSerial.requestPermissions();
  if (!permission.granted) throw new Error("Izin Bluetooth diperlukan untuk menghubungkan printer.");
  let status = await BluetoothSerial.isEnabled();
  if (!status.enabled) {
    await BluetoothSerial.enable();
    status = await BluetoothSerial.isEnabled();
  }
  if (!status.enabled) throw new Error("Bluetooth belum aktif.");
}
async function showPrinterPicker(type) {
  state.navbarMenu = "";
  state.printerTarget = type;
  state.printerDevices = [];
  state.printerLoading = true;
  state.modal = "printer";
  render();
  try {
    await ensureBluetoothReady();
    const result = await BluetoothSerial.listPairedDevices();
    state.printerDevices = result.devices || [];
  } catch (error) {
    state.modal = null;
    notice(error.message || "Tidak dapat membaca perangkat Bluetooth.", "danger");
  } finally {
    state.printerLoading = false;
    render();
  }
}
async function connectPrinter(address) {
  const device = state.printerDevices.find((item) => item.address === address);
  if (!device) return;
  try {
    await BluetoothSerial.connect({ address });
    state.printers[state.printerTarget] = device;
    state.modal = null;
    persist();
    render();
    notice(`Printer ${state.printerTarget === "cashier" ? "kasir" : "dapur"} terhubung: ${device.name || address}.`, "success");
  } catch (error) {
    notice(error.message || "Koneksi ke printer gagal.", "danger");
  }
}
async function printReceipt(order, type = "cashier", format = type === "kitchen" ? "kitchen" : "invoice") {
  if (!isNativeApp()) {
    window.print();
    return;
  }
  const printer = state.printers[type];
  if (!printer?.address) {
    notice(`Pilih printer ${type === "cashier" ? "kasir" : "dapur"} terlebih dahulu.`, "warning");
    return;
  }
  try {
    await ensureBluetoothReady();
    await BluetoothSerial.connect({ address: printer.address });
    await BluetoothSerial.write({ data: toBase64(format === "kitchen" ? kitchenReceiptText(order) : receiptText(order)) });
    await wait(900);
    await BluetoothSerial.disconnect();
    notice(`Struk dikirim ke ${printer.name || printer.address}.`, "success");
  } catch (error) {
    await BluetoothSerial.disconnect?.().catch(() => undefined);
    notice(error.message || "Struk gagal dikirim ke printer.", "danger");
  }
}
async function printCompletedOrder(order) {
  if (!isNativeApp()) {
    window.print();
    return;
  }
  await printReceipt(order, "cashier");
  await wait(2500);
  await printReceipt(order, "kitchen");
  await wait(2500);
  await printReceipt(order, "cashier", "kitchen");
}
function esc(value = "") {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}
function total() {
  return state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}
function reportingOrders() {
  return mergeReportOrders(state.serverHistory?.orders, state.orders);
}
function cloneOrderItems(items = []) {
  return items.map((item) => ({
    ...item,
    price: Number(item.price || item.unitPrice || item.finalPrice || 0),
    qty: Number(item.qty || item.quantity || 1),
    lineTotal: Number(item.lineTotal ?? Number(item.price || item.unitPrice || item.finalPrice || 0) * Number(item.qty || item.quantity || 1)),
  }));
}
function sameOrderIdentity(order, ref) {
  if (!order || !ref) return false;
  return (
    order.id === ref.id ||
    order.id === ref.clientOrderId ||
    order.clientOrderId === ref.id ||
    order.clientOrderId === ref.clientOrderId ||
    (order.serverOrderId && String(order.serverOrderId) === String(ref.serverOrderId)) ||
    (ref.serverOrderId && String(order.id) === String(ref.serverOrderId))
  );
}
function findLocalOrder(ref) {
  return state.orders.find((order) => sameOrderIdentity(order, ref));
}
function loadOpenBillForCheckout(order) {
  if (orderStatus(order) !== "OPEN BILL") return false;
  if (
    state.cart.length &&
    !state.activeBill &&
    !confirm("Keranjang saat ini akan diganti dengan data open bill. Lanjutkan?")
  )
    return true;
  state.activeBill = {
    id: order.id,
    clientOrderId: order.clientOrderId || order.id,
    serverOrderId: order.serverOrderId || null,
    createdAt: order.createdAt || new Date().toISOString(),
    status: "OPEN BILL",
    viewOnly: false,
    fromHistory: false,
  };
  state.table = order.table || "";
  state.cart = cloneOrderItems(order.items || []);
  state.modal = null;
  state.selected = null;
  state.editing = null;
  state.page = "transaksi";
  persist();
  render();
  notice(`Open bill ${state.table || ""} dimuat ke transaksi.`, "success");
  return true;
}
function loadOrderToSummary(order) {
  const status = orderStatus(order);
  if (
    state.cart.length &&
    !state.activeBill &&
    !confirm("Keranjang saat ini akan diganti dengan data history. Lanjutkan?")
  )
    return true;
  state.activeBill = {
    id: order.id,
    clientOrderId: order.clientOrderId || order.id,
    serverOrderId: order.serverOrderId || null,
    createdAt: order.createdAt || new Date().toISOString(),
    status,
    viewOnly: status !== "OPEN BILL",
    fromHistory: true,
  };
  state.table = order.table || "";
  state.cart = cloneOrderItems(order.items || []);
  state.modal = null;
  state.selected = null;
  state.editing = null;
  state.page = "transaksi";
  state.historyDrawerOpen = false;
  persist();
  render();
  notice(`${status === "OPEN BILL" ? "Open bill" : "Transaksi"} ${state.table || ""} dimuat ke Order Summary.`, "success");
  return true;
}
function reportExpense(date) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return Number(state.serverHistory?.expenses?.[key] || 0);
}
function report() {
  const orders = reportingOrders().filter(order => orderStatus(order) === "PAID");
  return {
    total: orders.reduce((s, o) => s + o.total, 0),
    count: orders.length,
    cash: orders
      .filter((o) => o.method === "cash")
      .reduce((s, o) => s + o.total, 0),
    qris: orders
      .filter((o) => o.method === "qris")
      .reduce((s, o) => s + o.total, 0),
    card: orders
      .filter((o) => o.method === "credit_card")
      .reduce((s, o) => s + o.total, 0),
  };
}
function orderDate(order) {
  const saved = new Date(order.createdAt || order.created || 0);
  return Number.isNaN(saved.getTime()) ? new Date() : saved;
}
function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
function startOfWeek(date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value;
}
function orderSummary(orders) {
  return orders.filter(order => orderStatus(order) === "PAID").reduce((summary, order) => {
    summary.total += Number(order.total || 0);
    summary.count += 1;
    const method = String(order.method || "").toLowerCase();
    if (method === "cash") summary.cash += Number(order.total || 0);
    else if (method === "qris") summary.qris += Number(order.total || 0);
    else if (method === "credit_card") summary.card += Number(order.total || 0);
    summary.cafe += order.items?.filter((item) => !["carwash", "detailing"].includes(item.cartType)).reduce((sum, item) => sum + Number(item.lineTotal ?? Number(item.price || 0) * Number(item.qty || 1)), 0) || 0;
    summary.carwash += order.items?.filter((item) => item.cartType === "carwash").reduce((sum, item) => sum + Number(item.lineTotal ?? Number(item.price || 0) * Number(item.qty || 1)), 0) || 0;
    summary.detailing += order.items?.filter((item) => item.cartType === "detailing").reduce((sum, item) => sum + Number(item.lineTotal ?? Number(item.price || 0) * Number(item.qty || 1)), 0) || 0;
    return summary;
  }, { total: 0, count: 0, cash: 0, qris: 0, card: 0, cafe: 0, carwash: 0, detailing: 0 });
}
function dashboardData() {
  const now = new Date();
  const today = reportingOrders().filter((order) => sameDay(orderDate(order), now));
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = reportingOrders().filter((order) => sameDay(orderDate(order), yesterdayDate));
  const weekStart = startOfWeek(now);
  const week = reportingOrders().filter((order) => orderDate(order) >= weekStart);
  const month = reportingOrders().filter((order) => {
    const date = orderDate(order);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const year = reportingOrders().filter((order) => orderDate(order).getFullYear() === now.getFullYear());
  const todaySummary = orderSummary(today);
  const previous = orderSummary(yesterday);
  const change = (value, before) => before ? Math.round(((value - before) / before) * 100) : value ? 100 : 0;
  return { now, today, month, todaySummary, week: orderSummary(week), monthSummary: orderSummary(month), year: orderSummary(year), revenueChange: change(todaySummary.total, previous.total), transactionChange: change(todaySummary.count, previous.count) };
}
function dashboardCanvas(canvas, range) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth || 640;
  const height = canvas.clientHeight || 260;
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  const now = new Date();
  const labels = range === "today" ? Array.from({ length: 8 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`) : range === "year" ? ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"] : range === "week" ? ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] : Array.from({ length: 6 }, (_, index) => `${index + 1}`);
  const values = labels.map((_, index) => reportingOrders().filter((order) => {
    const date = orderDate(order);
    if (range === "today") return sameDay(date, now) && Math.min(7, Math.max(0, date.getHours() - 9)) === index;
    if (range === "year") return date.getFullYear() === now.getFullYear() && date.getMonth() === index;
    if (range === "week") return date >= startOfWeek(now) && ((date.getDay() + 6) % 7) === index;
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && Math.min(5, Math.floor((date.getDate() - 1) / 5)) === index;
  }).reduce((sum, order) => sum + Number(order.total || 0), 0));
  const max = Math.max(...values, 1);
  const left = 44, top = 18, bottom = height - 34, chartWidth = width - left - 14;
  context.strokeStyle = "rgba(108, 117, 125, .2)";
  context.lineWidth = 1;
  for (let index = 0; index < 4; index += 1) {
    const y = top + ((bottom - top) * index) / 3;
    context.beginPath(); context.moveTo(left, y); context.lineTo(width - 14, y); context.stroke();
  }
  context.strokeStyle = "#28a745";
  context.fillStyle = "rgba(40, 167, 69, .14)";
  context.lineWidth = 2;
  context.beginPath();
  values.forEach((value, index) => {
    const x = left + (chartWidth * index) / Math.max(values.length - 1, 1);
    const y = bottom - ((bottom - top) * value) / max;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.lineTo(width - 14, bottom); context.lineTo(left, bottom); context.closePath(); context.fill();
  context.beginPath();
  values.forEach((value, index) => {
    const x = left + (chartWidth * index) / Math.max(values.length - 1, 1);
    const y = bottom - ((bottom - top) * value) / max;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.stroke();
  context.fillStyle = "#6c757d"; context.font = "11px sans-serif"; context.textAlign = "center";
  labels.forEach((label, index) => context.fillText(label, left + (chartWidth * index) / Math.max(labels.length - 1, 1), height - 12));
}
function notice(message, type = "info") {
  const node = document.createElement("div");
  node.className = `notice alert alert-${type}`;
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3600);
}
function setTheme() {
  const dark = state.theme === "dark";
  document.documentElement.dataset.themeMode = state.theme;
  document.documentElement.classList.toggle("dark-mode", dark);
  document.documentElement.classList.toggle("theme-preload-dark", dark);
  document.documentElement.classList.toggle("theme-preload-light", !dark);
  document.body.classList.toggle("dark-mode", dark);
  localStorage.setItem("adminlte-theme-mode", state.theme);
}
function setBodyLayout() {
  document.body.classList.add("hold-transition");
  document.body.classList.toggle("login-page", !state.session);
  document.body.classList.toggle("sidebar-mini", Boolean(state.session));
  document.body.classList.toggle("layout-fixed", Boolean(state.session));
  document.body.classList.toggle("layout-navbar-fixed", Boolean(state.session));
  document.body.classList.toggle("sidebar-open", Boolean(state.session && state.sidebarOpen));
  document.body.classList.toggle("sidebar-collapse", Boolean(state.session && !state.sidebarOpen));
}
async function api(path, token = "", init = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(token
      ? { Authorization: `Bearer ${token}`, "X-API-Token": token }
      : {}),
    ...init.headers,
  };
  const response = await fetch(`${API}/${path}`, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Koneksi server gagal.");
    error.status = response.status;
    throw error;
  }
  return data;
}
function categories() {
  return state.categories;
}
function isAllCategory(category) {
  return category === "All" || category === "all";
}
function variants(product) {
  if (product.variants?.length) return product.variants;
  if (!product.variant || !product.nama_var) return [];
  const names = product.nama_var
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const prices = String(product.biaya_var || "")
    .split(";")
    .map((x) => Number(x.trim()) || product.price);
  return names.map((name, index) => ({
    name,
    price: prices[index] || product.price,
  }));
}
function productImage(product) {
  if (!product.image) return "";
  if (/^https?:\/\//i.test(product.image) || product.image.startsWith("/"))
    return product.image;
  return `${API.replace(/\/api\/mobile$/, "")}/${product.image.replace(/^\//, "")}`;
}

function loginView() {
  return `<div class="hold-transition login-page bg login-reference"><div class="login-box"><div class="card login-card"><div class="card-body login-card-body"><div class="login-logo text-center"><img src="/server-assets/img/logo-dejati-black.PNG" alt="De'Jati"><p class="login-title">Login Kasir</p><p class="login-subtitle">De'Jati Coffee Garden &amp; Carwash</p></div><form id="login-form"><input class="form-control mb-3" name="username" placeholder="Username" required autofocus><input class="form-control mb-4" name="password" type="password" placeholder="Password" required><button class="btn btn-primary btn-block btn-login">Log In</button></form></div></div></div></div>`;
}
function shell(content) {
  const user = state.session.user?.name || "Kasir";
  const title =
    state.page === "dashboard"
      ? "Dashboard"
      : state.page === "transaksi"
        ? "Transaksi Kasir"
        : state.page === "history" ? "History Transaksi" : "Closing Harian";
  return `<div class="wrapper"><nav class="main-header navbar navbar-expand ${state.theme === "dark" ? "navbar-dark navbar-gray-dark" : "navbar-white navbar-light"}"><button class="nav-link btn-nav" data-action="sidebar"><i class="fas fa-bars"></i></button><span class="h5 mb-0">${title}</span><div class="ml-auto"><button class="btn btn-sm btn-outline-primary mr-2" data-action="sync" ${state.syncing ? "disabled" : ""}><i class="fas fa-sync-alt ${state.syncing ? "fa-spin" : ""}"></i> ${state.syncing ? "Sync..." : "Sync"}</button><button class="btn btn-sm btn-link" data-action="theme" aria-label="Ganti tema"><i class="fas fa-${state.theme === "dark" ? "sun" : "moon"}"></i></button></div></nav><aside class="main-sidebar sidebar-dark-primary elevation-4"><a class="brand-link"><img src="/server-assets/img/logo-only-white.png" class="brand-image"><span class="brand-text font-weight-light"><b>De'</b>Jati</span></a><div class="sidebar"><div class="user-panel mt-3 pb-3 mb-3 d-flex"><img src="/server-assets/img/user-no-image-gray.png" class="img-circle elevation-2" width="34"><div class="info"><span>${esc(user)}</span></div></div><nav><ul class="nav nav-pills nav-sidebar flex-column"><li class="nav-item"><button class="nav-link nav-button ${state.page === "dashboard" ? "active" : ""}" data-page="dashboard"><i class="nav-icon fas fa-tachometer-alt"></i><p>Dashboard</p></button></li><li class="nav-item"><button class="nav-link nav-button ${state.page === "transaksi" ? "active" : ""}" data-page="transaksi"><i class="nav-icon fas fa-cash-register"></i><p>Transaksi</p></button></li><li class="nav-item"><button class="nav-link nav-button ${state.page === "report" ? "active" : ""}" data-page="report"><i class="nav-icon fas fa-calendar-day"></i><p>Closing Harian</p></button></li><li class="nav-item mt-3"><button class="nav-link nav-button" data-action="logout"><i class="nav-icon fas fa-sign-out-alt"></i><p>Logout</p></button></li></ul></nav></div></aside><div class="content-wrapper">${content}</div></div>`;
}
function dashboardContent(data, average, openBills, stat, periodRow, payment, topProducts) {
  const recent = reportingOrders().slice(0, 5).map((order) => `<tr><td>${orderDate(order).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(order.table || "-")}</td><td>${esc(String(order.method || "-").replace("_", " "))}</td><td><span class="badge badge-${orderStatus(order) === "PAID" ? "success" : orderStatus(order) === "CANCEL" ? "danger" : "warning"}">${orderStatus(order)}</span></td><td class="text-right">${money(order.total)}</td></tr>`).join("");
  return `<section class="content pt-3"><div class="container-fluid"><div class="dashboard-hero mb-3"><div class="row align-items-center"><div class="col-lg-8"><h4>Halo, ${esc(state.session.user?.name || "Kasir")}!</h4><p class="mt-1">Ringkasan operasional De'Jati hari ini, ${data.now.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}. Anda login sebagai ${esc(state.session.user?.role || "-")}.</p></div><div class="col-lg-4 mt-3 mt-lg-0 text-lg-right"><button class="btn btn-light btn-sm" data-page="transaksi"><i class="fas fa-cash-register"></i> Buka Transaksi</button><button class="btn btn-outline-light btn-sm" data-page="history"><i class="fas fa-history"></i> History Transaksi</button></div></div></div><div class="row">${stat("Omzet Hari Ini", money(data.todaySummary.total), `${data.revenueChange >= 0 ? "+" : ""}${data.revenueChange}% vs kemarin`, "fa-wallet", "success")}${stat("Total Transaksi Hari Ini", data.todaySummary.count.toLocaleString("id-ID"), `${data.transactionChange >= 0 ? "+" : ""}${data.transactionChange}% vs kemarin`, "fa-receipt", "info")}${stat("Rata-rata Belanja", money(average), `${openBills} open bill belum final`, "fa-chart-line", "warning")}${stat("Nett Hari Ini", money(data.todaySummary.total - reportExpense(data.now)), `Pengeluaran ${money(reportExpense(data.now))}`, "fa-balance-scale", "primary")}</div><div class="row"><div class="col-xl-8"><div class="card dash-card"><div class="card-header"><div class="row align-items-center"><div class="col-md-7"><h3 class="card-title mb-0"><i class="fas fa-chart-area mr-1"></i> Trend Histori Transaksi</h3></div><div class="col-md-5 mt-2 mt-md-0"><select id="dashboardTrendRange" class="form-control form-control-sm"><option value="today">Hari Ini per Jam</option><option value="week">Minggu Ini</option><option value="month" ${state.dashboardRange === "month" ? "selected" : ""}>Bulan Ini</option><option value="year">Tahun Ini</option></select></div></div></div><div class="card-body"><div class="dash-chart-wrap"><canvas id="dashboardTrendChart"></canvas></div></div></div></div><div class="col-xl-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-layer-group mr-1"></i> Ringkasan Periode</h3></div><div class="card-body p-0"><table class="table table-striped dash-table mb-0"><thead><tr><th>Periode</th><th class="text-right">Transaksi</th><th class="text-right">Omzet</th></tr></thead><tbody>${periodRow("Hari Ini", data.todaySummary)}${periodRow("Minggu Ini", data.week)}${periodRow("Bulan Ini", data.monthSummary)}${periodRow("Tahun Ini", data.year)}</tbody></table></div></div></div></div><div class="row"><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-credit-card mr-1"></i> Metode Pembayaran Hari Ini</h3></div><div class="card-body">${payment.map(([label, value, color]) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${label}</span><strong>${money(value)}</strong></div><div class="progress progress-sm"><div class="progress-bar bg-${color}" style="width:${data.todaySummary.total ? Math.round((value / data.todaySummary.total) * 100) : 0}%"></div></div></div>`).join("")}</div></div></div><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-store mr-1"></i> Pendapatan per Unit Hari Ini</h3></div><div class="card-body"><div class="d-flex justify-content-between mb-2"><span>Cafe</span><strong>${money(data.todaySummary.cafe)}</strong></div><div class="d-flex justify-content-between mb-2"><span>Carwash</span><strong>${money(data.todaySummary.carwash)}</strong></div><div class="d-flex justify-content-between"><span>Detailing</span><strong>${money(data.todaySummary.detailing)}</strong></div></div></div></div><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-info-circle mr-1"></i> Info Operasional</h3></div><div class="card-body"><div class="info-box bg-light"><span class="info-box-icon bg-success"><i class="fas fa-mug-hot"></i></span><div class="info-box-content"><span class="info-box-text">Total Produk Terdaftar</span><span class="info-box-number">${state.products.length}</span></div></div><div class="info-box bg-light mb-0"><span class="info-box-icon bg-warning"><i class="fas fa-file-invoice"></i></span><div class="info-box-content"><span class="info-box-text">Open Bill Hari Ini</span><span class="info-box-number">${openBills}</span></div></div></div></div></div></div><div class="row"><div class="col-xl-6"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-star mr-1"></i> Produk Terlaris Bulan Ini</h3></div><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped dash-table mb-0"><thead><tr><th>Produk</th><th>Kategori</th><th class="text-right">Qty</th><th class="text-right">Omzet</th></tr></thead><tbody>${topProducts.map((item) => `<tr><td>${esc(item.name)}</td><td><span class="badge badge-light border">${item.category}</span></td><td class="text-right">${item.qty}</td><td class="text-right">${money(item.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="dash-empty">Belum ada penjualan produk bulan ini.</td></tr>`}</tbody></table></div></div></div></div><div class="col-xl-6"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-list mr-1"></i> Transaksi Terbaru</h3></div><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped dash-table mb-0"><thead><tr><th>Waktu</th><th>Meja</th><th>Metode</th><th>Status</th><th class="text-right">Total</th></tr></thead><tbody>${recent || `<tr><td colspan="5" class="dash-empty">Belum ada transaksi.</td></tr>`}</tbody></table></div></div></div></div></div></div></section>`;
}
function dashboardView() {
  const data = dashboardData();
  const average = data.todaySummary.count ? Math.floor(data.todaySummary.total / data.todaySummary.count) : 0;
  const openBills = data.today.filter((order) => orderStatus(order) === "OPEN BILL").length;
  const stat = (label, value, note, icon, color) => `<div class="col-xl-3 col-md-6"><div class="card dash-card dash-stat"><div class="card-body"><div><div class="dash-stat-label">${label}</div><div class="dash-stat-value">${value}</div><div class="dash-stat-note">${note}</div></div><span class="dash-icon bg-${color}"><i class="fas ${icon}"></i></span></div></div></div>`;
  const periodRow = (label, value) => `<tr><td>${label}</td><td class="text-right">${value.count.toLocaleString("id-ID")}</td><td class="text-right">${money(value.total)}</td></tr>`;
  const payment = [["Cash", data.todaySummary.cash, "success"], ["QRIS", data.todaySummary.qris, "info"], ["Kartu", data.todaySummary.card, "warning"]];
  const topProducts = Object.values(data.month.filter(order => orderStatus(order) === "PAID").flatMap((order) => order.items || []).reduce((items, item) => {
    const key = item.name;
    items[key] ||= { name: item.name, category: item.cartType === "carwash" ? "Carwash" : item.cartType === "detailing" ? "Detailing" : "Cafe", qty: 0, total: 0 };
    items[key].qty += Number(item.qty || 1); items[key].total += Number(item.price || 0) * Number(item.qty || 1);
    return items;
  }, {})).sort((a, b) => b.total - a.total).slice(0, 5);
  return dashboardContent(data, average, openBills, stat, periodRow, payment, topProducts);
  /*
  return `<section class="content pt-3"><div class="container-fluid"><div class="dashboard-hero mb-3"><div class="row align-items-center"><div class="col-lg-8"><h4>Halo, ${esc(state.session.user?.name || "Kasir")}!</h4><p class="mt-1">Ringkasan operasional De'Jati hari ini, ${data.now.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}. Anda login sebagai ${esc(state.session.user?.role || "-")}.</p></div><div class="col-lg-4 mt-3 mt-lg-0 text-lg-right"><button class="btn btn-light btn-sm" data-page="transaksi"><i class="fas fa-cash-register"></i> Buka Transaksi</button><button class="btn btn-outline-light btn-sm" data-page="history"><i class="fas fa-history"></i> History Transaksi</button></div></div></div><div class="row">${stat("Omzet Hari Ini", money(data.todaySummary.total), `${data.revenueChange >= 0 ? "+" : ""}${data.revenueChange}% vs kemarin`, "fa-wallet", "success")}${stat("Total Transaksi Hari Ini", data.todaySummary.count.toLocaleString("id-ID"), `${data.transactionChange >= 0 ? "+" : ""}${data.transactionChange}% vs kemarin`, "fa-receipt", "info")}${stat("Rata-rata Belanja", money(average), `${openBills} open bill belum final`, "fa-chart-line", "warning")}${stat("Nett Hari Ini", money(data.todaySummary.total - reportExpense(data.now)), `Pengeluaran ${money(reportExpense(data.now))}`, "fa-balance-scale", "primary")}</div><div class="row"><div class="col-xl-8"><div class="card dash-card"><div class="card-header"><div class="row align-items-center"><div class="col-md-7"><h3 class="card-title mb-0"><i class="fas fa-chart-area mr-1"></i> Trend Histori Transaksi</h3></div><div class="col-md-5 mt-2 mt-md-0"><select id="dashboardTrendRange" class="form-control form-control-sm"><option value="today">Hari Ini per Jam</option><option value="week">Minggu Ini</option><option value="month" ${state.dashboardRange === "month" ? "selected" : ""}>Bulan Ini</option><option value="year">Tahun Ini</option></select></div></div></div><div class="card-body"><div class="dash-chart-wrap"><canvas id="dashboardTrendChart"></canvas></div></div></div></div><div class="col-xl-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-layer-group mr-1"></i> Ringkasan Periode</h3></div><div class="card-body p-0"><table class="table table-striped dash-table mb-0"><thead><tr><th>Periode</th><th class="text-right">Transaksi</th><th class="text-right">Omzet</th></tr></thead><tbody>${periodRow("Hari Ini", data.todaySummary)}${periodRow("Minggu Ini", data.week)}${periodRow("Bulan Ini", data.monthSummary)}${periodRow("Tahun Ini", data.year)}</tbody></table></div></div><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-clock mr-1"></i> Jam Tersibuk Hari Ini</h3></div><div class="card-body"><div class="d-flex justify-content-between align-items-center"><div><div class="dash-stat-value">${data.today.length ? `${String(orderDate(data.today[0]).getHours()).padStart(2, "0")}:00` : "-"}</div><div class="dash-stat-note">${data.todaySummary.count} transaksi, ${money(data.todaySummary.total)}</div></div><span class="dash-icon bg-secondary"><i class="fas fa-stopwatch"></i></span></div></div></div></div></div><div class="row"><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-credit-card mr-1"></i> Metode Pembayaran Hari Ini</h3></div><div class="card-body">${payment.map(([label, value, color]) => `<div class="mb-2"><div class="d-flex justify-content-between"><span>${label}</span><strong>${money(value)}</strong></div><div class="progress progress-sm"><div class="progress-bar bg-${color}" style="width:${data.todaySummary.total ? Math.round((value / data.todaySummary.total) * 100) : 0}%"></div></div></div>`).join("")}</div></div></div><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-store mr-1"></i> Cafe vs Carwash Hari Ini</h3></div><div class="card-body"><div class="d-flex justify-content-between mb-2"><span>Cafe</span><strong>${money(data.todaySummary.cafe)}</strong></div><div class="d-flex justify-content-between"><span>Carwash</span><strong>${money(data.todaySummary.carwash)}</strong></div></div></div></div><div class="col-lg-4"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-info-circle mr-1"></i> Info Operasional</h3></div><div class="card-body"><div class="info-box bg-light"><span class="info-box-icon bg-info"><i class="fas fa-users"></i></span><div class="info-box-content"><span class="info-box-text">Pengguna Aktif</span><span class="info-box-number">1 / 1</span></div></div><div class="info-box bg-light"><span class="info-box-icon bg-success"><i class="fas fa-mug-hot"></i></span><div class="info-box-content"><span class="info-box-text">Total Produk Terdaftar</span><span class="info-box-number">${state.products.length}</span></div></div><div class="info-box bg-light mb-0"><span class="info-box-icon bg-warning"><i class="fas fa-file-invoice"></i></span><div class="info-box-content"><span class="info-box-text">Open Bill Hari Ini</span><span class="info-box-number">${openBills}</span></div></div></div></div></div></div><div class="row"><div class="col-xl-6"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-star mr-1"></i> Produk Terlaris Bulan Ini</h3></div><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped dash-table mb-0"><thead><tr><th>Produk</th><th>Kategori</th><th class="text-right">Qty</th><th class="text-right">Omzet</th></tr></thead><tbody>${topProducts.map((item) => `<tr><td>${esc(item.name)}</td><td><span class="badge badge-light border">${item.category}</span></td><td class="text-right">${item.qty}</td><td class="text-right">${money(item.total)}</td></tr>`).join("") || `<tr><td colspan="4" class="dash-empty">Belum ada penjualan produk bulan ini.</td></tr>`}</tbody></table></div></div></div></div><div class="col-xl-6"><div class="card dash-card"><div class="card-header"><h3 class="card-title mb-0"><i class="fas fa-list mr-1"></i> Transaksi Terbaru</h3></div><div class="card-body p-0"><div class="table-responsive"><table class="table table-striped dash-table mb-0"><thead><tr><th>Waktu</th><th>Meja</th><th>Metode</th><th>Status</th><th class="text-right">Total</th></tr></thead><tbody>${reportingOrders().slice(0, 5).map((order) => `<tr><td>${orderDate(order).toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(order.table || "-")}</td><td>${esc(String(order.method || "-").replace("_", " "))}</td><td><span class="badge badge-${order.paid ? "success">Paid" : "warning">Open Bill"}</span></td><td class="text-right">${money(order.total)}</td></tr>`).join("") || `<tr><td colspan="5" class="dash-empty">Belum ada transaksi.</td></tr>`}</tbody></table></div></div></div></div></div></div></section>`;
*/
}
function filteredProducts() {
  return state.products.filter(
    (p) =>
      (isAllCategory(state.category) || p.category === state.category) &&
      p.name.toLowerCase().includes(state.search.toLowerCase()),
  );
}
function productListView(products = filteredProducts()) {
  return products
    .map(
      (product) =>
        `<div class="col-md-2 col-4 mb-2 px-1 product-column" data-category="${esc(product.category)}" data-name="${esc(product.name.toLowerCase())}"><button class="card product-card shadow-sm p-1" data-product="${esc(product.id)}">${productImage(product) ? `<img class="card-img-top p-1 mx-auto d-block" src="${esc(productImage(product))}" alt="${esc(product.name)}" width="100" height="100">` : `<div class="product-no-img card-img-top p-1">${esc(
          product.name
            .split(/\s+/)
            .map((word) => word[0])
            .join("")
            .slice(0, 3),
        )}</div>`}<div class="card-body text-center p-2"><h6 class="product-title mb-1 text-left">${esc(product.name)}</h6><p class="product-price mb-0 text-right text-muted">${money(variants(product)[0]?.price || product.price)}</p></div></button></div>`,
    )
    .join("") || `<p class="text-muted p-3">${state.products.length ? "Produk tidak ditemukan." : "Katalog belum tersedia. Sinkronisasi database akan berjalan saat halaman dimuat."}</p>`;
}
function updateProductList() {
  const list = document.querySelector("#product-list");
  if (list) list.innerHTML = productListView();
}
function updateCategoryTabs() {
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === state.category);
  });
}
function currentCartOrder() {
  return {
    id: state.activeBill?.id || "current-order",
    table: state.table || "-",
    method: "-",
    subtotal: total(),
    discount: 0,
    total: total(),
    paid: 0,
    change: 0,
    createdAt: new Date().toISOString(),
    items: cloneOrderItems(state.cart),
  };
}
function todayHistoryOrders() {
  const now = new Date();
  return reportingOrders().filter((order) => sameDay(orderDate(order), now));
}
function historyDrawerView(orders) {
  const rows = orders
    .map((order, index) => {
      const status = orderStatus(order);
      const badge = status === "PAID" ? "success" : status === "CANCEL" ? "danger" : "warning";
      return `<tr class="history-order-row" data-history-index="${index}"><td>${orderDate(order).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(order.table || "-")}</td><td><span class="badge badge-${badge}">${status}</span></td><td class="text-right">${money(order.total)}</td></tr>`;
    })
    .join("");
  return `<div class="order-history-backdrop ${state.historyDrawerOpen ? "show" : ""}" data-action="close-history"></div><aside class="order-history-drawer ${state.historyDrawerOpen ? "show" : ""}" aria-hidden="${state.historyDrawerOpen ? "false" : "true"}"><div class="order-history-header"><h6 class="mb-0"><i class="fas fa-history mr-1"></i> History Hari Ini</h6><button type="button" class="close" data-action="close-history" aria-label="Tutup">&times;</button></div><div class="table-responsive order-history-table"><table class="table table-sm table-hover mb-0"><thead><tr><th>Time</th><th>Table</th><th>Status</th><th class="text-right">Total</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="text-muted text-center py-3">Belum ada transaksi hari ini.</td></tr>`}</tbody></table></div></aside>`;
}
function canEditCart() {
  return !state.activeBill?.viewOnly;
}
function canEditSummaryItems() {
  if (!state.activeBill) return true;
  return state.activeBill.status !== "CANCEL";
}
async function cancelSummaryOrder() {
  if (!state.activeBill) return notice("Pilih transaksi dari history terlebih dahulu.", "warning");
  const reason = await sweetTextarea({
    title: "Cancel Transaction",
    text: "Masukkan alasan cancel transaction.",
    placeholder: "Alasan cancel...",
    confirmButtonText: "Cancel Transaction",
  });
  if (reason === null) return;
  if (!reason.trim()) return notice("Alasan cancel wajib diisi.", "warning");
  const local = findLocalOrder(state.activeBill);
  const existing = local || reportingOrders().find((order) => sameOrderIdentity(order, state.activeBill));
  if (!existing) return notice("Data transaksi tidak ditemukan.", "warning");
  if (orderStatus(existing) === "CANCEL") return notice("Transaksi ini sudah cancel.", "info");
  if (existing.serverOrderId && state.session?.token) {
    if (!navigator.onLine) return notice("Cancel transaksi server memerlukan koneksi internet.", "warning");
    await api("order-cancel", state.session.token, {
      method: "POST",
      body: JSON.stringify({ id: existing.serverOrderId, reason: reason.trim() }),
    });
  }
  const update = { status: "CANCEL", cancelReason: reason.trim(), canceledAt: new Date().toISOString() };
  Object.assign(existing, update);
  if (local && local !== existing) Object.assign(local, update);
  if (!local && !state.serverHistory?.orders?.some((order) => sameOrderIdentity(order, existing)))
    state.orders.unshift({ ...existing, ...update, synced: false });
  state.activeBill = { ...state.activeBill, status: "CANCEL", viewOnly: true };
  persist();
  render();
  notice("Status order berhasil diubah menjadi CANCEL.", "success");
  if (navigator.onLine) void sync(true);
}
function orderActionButton(action, icon, label, color = "secondary", size = "sm", disabled = false) {
  return `<button type="button" class="btn btn-${color} btn-sm order-action-btn order-action-${size}" data-action="${action}" ${disabled ? "disabled" : ""}><i class="fas ${icon}"></i><small>${label}</small></button>`;
}
function transactionView() {
  const historyOrders = todayHistoryOrders();
  const editable = canEditCart();
  const summaryItemsEditable = canEditSummaryItems();
  const selectedStatus = state.activeBill?.status || "";
  const activeBillBadge = state.activeBill ? `<span class="badge badge-${editable ? "warning" : "secondary"} ml-2">${editable ? "Open Bill" : "History"}</span>` : "";
  const isHistoryOrder = Boolean(state.activeBill?.fromHistory || state.activeBill?.viewOnly);
  const cancelDisabled = !isHistoryOrder || selectedStatus === "CANCEL";
  const cancelAction = orderActionButton("cancel-transaction", "fa-ban", "Cancel Transaksi", "danger", "sm", cancelDisabled);
  const orderActions = `<div class="order-primary-actions">${orderActionButton("pay", "fa-money-bill-wave", "Pay Now", "success", "lg", !editable)}${orderActionButton("bill", "fa-file-alt", "Open Bill", "info", "lg", !editable)}</div><div class="order-action-grid">${orderActionButton("print-chit", "fa-receipt", "Print Chit", "secondary")}${orderActionButton("print-invoice-cashier", "fa-file-invoice", "Print Invoice", "primary")}${cancelAction}</div>`;
  return `<section class="content transaction-screen pt-3"><div class="container-fluid p-0"><div class="row transaction-row"><div class="col-lg-4"><div class="position-sticky order-panel"><div class="card d-flex flex-column order-card"><div class="card-header bg-primary text-white order-summary-header"><h5 class="mb-0 order-summary-title">Order Summary${activeBillBadge}</h5><div class="order-header-actions"><button type="button" class="btn btn-sm btn-danger order-header-btn" data-action="clear"><i class="fas fa-trash"></i><small>Clear</small></button><button type="button" class="btn btn-sm btn-light order-history-toggle" data-action="toggle-history"><i class="fas fa-history"></i><small>History</small></button></div></div><div class="card-body d-flex flex-column p-2"><div class="table-responsive flex-grow-1 order-items-scroll"><table class="table table-sm mb-3 text-center" id="order-table"><thead class="bg-light"><tr><th>Item</th><th style="width:90px">Price</th><th style="width:60px">Qty</th><th style="width:90px">Total</th></tr></thead><tbody>${state.cart.length ? state.cart.map((item, index) => `<tr class="cart-row" ${summaryItemsEditable ? `data-edit="${index}"` : ""}><td class="text-left ${item.hold ? "text-danger" : ""}">${esc(item.name)}${item.notes ? `<small class="d-block text-muted">**${esc(item.notes)}</small>` : ""}</td><td>${money(item.price)}</td><td>${item.qty}</td><td>${money(item.price * item.qty)}</td></tr>`).join("") : ""}</tbody></table></div><div class="order-summary-footer border-top pt-2"><h5 class="order-total-label">Total: <span id="total-amount">${money(total())}</span></h5>${orderActions}</div></div></div></div></div><div class="col-lg-8 transaction-products-panel"><div class="product-filter-bar"><input id="product-search" class="form-control mb-2" value="${esc(state.search)}" placeholder="Search product..."><ul class="nav nav-pills d-flex justify-content-start nav-pills-custom border rounded p-1 mb-2" id="categoryTabs" role="tablist">${categories()
    .map(
      (category) =>
        `<li class="nav-item mr-1" role="presentation"><button class="order-cat nav-link btn btn-outline btn-sm p-1 flex-column align-items-center ${category.id === state.category ? "active" : ""}" data-category="${esc(category.id)}"><span class="material-symbols-outlined">${esc(category.icon)}</span><span class="text-dark text-bold d-block">${esc(category.label)}</span></button></li>`,
    )
    .join(
      "",
    )}</ul></div><div class="card shadow-sm product-grid-card"><div class="card-body"><div class="row justify-content-left" id="product-list">${productListView()}</div></div></div></div></div></div>${historyDrawerView(historyOrders)}</section>`;
}
function reportView() { return reports.view(state.page); }
function paymentModal() {
  return `<div class="modal-backdrop-mobile" id="payModal"><div class="modal-dialog"><form class="modal-content" id="pay-form"><div class="modal-header bg-primary text-white"><h5 class="modal-title">Payment</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body"><div class="form-group"><label for="table-number">Table Number</label><input class="form-control" id="table-number" name="table" value="${esc(state.table)}" placeholder="e.g. A1 / VIP 2 / Takeaway" required></div><div class="form-group"><label for="payment-method">Payment Method</label><select class="form-control" id="payment-method" name="method" required><option value="">-- Select Method --</option><option value="cash">Cash</option><option value="credit_card">Credit Card</option><option value="qris">QRIS</option></select></div><div class="form-group"><label>Subtotal</label><input class="form-control" id="modal-subtotal" readonly></div><div class="form-group"><label for="payment-discount">Discount (%)</label><input class="form-control" id="payment-discount" name="discount" inputmode="numeric" placeholder="0" value="0"><small class="form-text text-muted">Example: enter 10 for 10% discount.</small></div><div class="form-group"><label>Grand Total</label><input class="form-control" id="modal-total" readonly></div><div class="form-group"><label for="customer-pay">Customer Pay</label><input class="form-control" id="customer-pay" name="paid" inputmode="numeric" required><div class="btn-group btn-group-sm mt-2"><button type="button" class="btn btn-outline-primary quick-pay" data-quick-pay="50000">50.000</button><button type="button" class="btn btn-outline-primary quick-pay" data-quick-pay="100000">100.000</button><button type="button" class="btn btn-outline-primary quick-pay" data-quick-pay="500000">500.000</button></div></div><div class="form-group"><label>Change</label><input class="form-control" id="change-amount" readonly></div></div><div class="modal-footer justify-content-between"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary">Print Invoice</button></div></form></div></div>`;
}
function updatePaymentSummary() {
  const subtotal = total();
  const discountInput = document.querySelector("#payment-discount");
  const method = document.querySelector("#payment-method")?.value || "";
  const paidInput = document.querySelector("#customer-pay");
  const percent = Math.min(100, Math.max(0, Number(discountInput?.value || 0)));
  const grandTotal = subtotal - Math.floor((subtotal * percent) / 100);
  if (method === "qris" || method === "credit_card") paidInput.value = formatDigits(grandTotal);
  const paid = Number(String(paidInput?.value || 0).replace(/\D/g, ""));
  document.querySelector("#modal-subtotal").value = money(subtotal);
  document.querySelector("#modal-total").value = money(grandTotal);
  document.querySelector("#change-amount").value = money(Math.max(0, paid - grandTotal));
}
function modalView() {
  if (!state.modal) return "";
  if (state.modal === "printer") {
    const label = state.printerTarget === "cashier" ? "Kasir" : "Dapur";
    const devices = state.printerDevices.map((device) => `<button class="list-group-item list-group-item-action" data-printer-address="${esc(device.address)}"><strong>${esc(device.name || "Perangkat tanpa nama")} ${esc(String(device.address).slice(-5))}</strong><small class="d-block text-muted">${esc(device.address)}</small></button>`).join("");
    return `<div class="modal-backdrop-mobile"><div class="modal-dialog"><div class="modal-content"><div class="modal-header bg-primary text-white"><h5 class="modal-title">Pilih Printer ${label}</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body">${state.printerLoading ? `<p class="text-muted mb-0"><i class="fas fa-spinner fa-spin mr-1"></i>Membaca perangkat Bluetooth...</p>` : devices || `<p class="text-muted mb-0">Tidak ada perangkat yang sudah dipasangkan. Pasangkan printer dari Pengaturan Bluetooth Android, lalu coba lagi.</p>`}</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-close>Batal</button></div></div></div></div>`;
  }
  if (state.modal === "pay") return paymentModal();
  if (state.modal === "reports") return reports.modal();

  if (state.modal === "variant")
    return `<div class="modal-backdrop-mobile" id="variantModal"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header bg-primary text-white"><h5 class="modal-title">Select Variant</h5><button class="close text-white" data-close>&times;</button></div><div class="modal-body"><div class="list-group" id="variant-options">${variants(
      state.selected,
    )
      .map(
        (variant, index) =>
          `<button class="list-group-item list-group-item-action d-flex justify-content-between" data-variant="${index}"><span>${esc(state.selected.name)} - ${esc(variant.name)}</span><strong>${money(variant.price)}</strong></button>`,
      )
      .join("")}</div></div></div></div></div>`;
  const item = state.selected;
  const edit = state.editing !== null ? state.cart[state.editing] : null;
  if (state.modal === "item")
    return `<div class="modal-backdrop-mobile"><div class="modal-dialog"><form class="modal-content" id="item-form"><div class="modal-header bg-primary text-white"><h5 class="modal-title">${esc(item.name)}</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body"><label>Qty</label><div class="input-group mb-3"><div class="input-group-prepend"><button class="btn btn-outline-secondary" type="button" data-qty="-1">-</button></div><input id="item-qty" class="form-control text-center" name="qty" inputmode="numeric" value="${edit?.qty || 1}"><div class="input-group-append"><button class="btn btn-outline-secondary" type="button" data-qty="1">+</button></div></div><label>Catatan</label><textarea class="form-control mb-3" name="notes">${esc(edit?.notes || "")}</textarea><div class="custom-control custom-switch"><input class="custom-control-input" type="checkbox" id="order-type" ${edit?.orderType !== "take-away" ? "checked" : ""}><label class="custom-control-label" for="order-type">Dine-in (matikan untuk Take-away)</label></div></div><div class="modal-footer justify-content-between">${edit ? `<button class="btn btn-danger" type="button" data-action="remove-item">Hapus Item</button>` : "<span></span>"}<div><button class="btn btn-secondary mr-2" type="button" data-close>Cancel</button><button class="btn btn-primary">Save</button></div></div></form></div></div>`;
  if (state.modal === "carwash") {
    const serviceLabel = (item.cartType || item.category) === "detailing" ? "Detailing" : "Carwash";
    return `<div class="modal-backdrop-mobile"><div class="modal-dialog"><form class="modal-content" id="carwash-form"><div class="modal-header bg-primary text-white"><h5 class="modal-title">${esc(serviceLabel)} - ${esc(item.name)}</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body"><label>Nomor Polisi</label><input class="form-control mb-2" name="nopol" value="${esc(edit?.nopol || "")}" required><label>Service</label><input class="form-control mb-2" name="service" value="${esc(edit?.service || item.variantName || item.name || "")}"><label>Ukuran Kendaraan</label><input class="form-control mb-3" name="ukuran" value="${esc(edit?.ukuran || item.variantName || "")}"><div><label class="mr-3"><input type="radio" name="vacuum" value="yes" ${edit?.vacuum === "yes" ? "checked" : ""}> Vacuum Ya (+Rp5.000)</label><label><input type="radio" name="vacuum" value="no" ${edit?.vacuum !== "yes" ? "checked" : ""}> Tidak</label></div></div><div class="modal-footer"><button class="btn btn-secondary mr-auto" type="button" data-action="hold-carwash">Hold</button><button class="btn btn-outline-secondary mr-2" type="button" data-close>Cancel</button><button class="btn btn-success">Save</button></div></form></div></div>`;
  }
  if (state.modal === "pay")
    return `<div class="modal-backdrop-mobile"><div class="modal-dialog"><form class="modal-content" id="pay-form"><div class="modal-header bg-primary text-white"><h5 class="modal-title">Payment</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body"><label>Table Number</label><input class="form-control mb-2" name="table" value="${esc(state.table)}" required placeholder="A1 / VIP 2 / Takeaway"><label>Metode Pembayaran</label><select class="form-control mb-2" name="method"><option value="cash">Cash</option><option value="qris">QRIS</option><option value="credit_card">Kartu Kredit</option></select><label>Diskon (%)</label><input class="form-control mb-2" name="discount" inputmode="numeric" value="0"><label>Bayar</label><input class="form-control" name="paid" inputmode="numeric" value="${total()}"></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary">Simpan &amp; Print</button></div></form></div></div>`;
  return `<div class="modal-backdrop-mobile"><div class="modal-dialog"><form class="modal-content" id="bill-form"><div class="modal-header bg-info text-white"><h5 class="modal-title">Open Bill</h5><button class="close text-white" type="button" data-close>&times;</button></div><div class="modal-body"><label>Table Number</label><input class="form-control form-control-lg" name="table" value="${esc(state.table)}" placeholder="A1 / VIP 2 / Takeaway" required></div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-info">Save Open Bill</button></div></form></div></div>`;
}
function render() {
  setTheme();
  setBodyLayout();
  if (!state.session) {
    app.innerHTML = loginView();
    return;
  }
  const content =
    state.page === "dashboard"
      ? dashboardView()
      : state.page === "transaksi"
        ? transactionView()
        : reportView();
  app.innerHTML = shell(content) + modalView();
  document.querySelector("[data-action='sync']")?.remove();
  decorateReferenceNavbar();
  decorateReferenceSidebar();
  decorateReferenceToggle();
  decorateReferenceModal();
  if (state.page === "dashboard") dashboardCanvas(document.querySelector("#dashboardTrendChart"), state.dashboardRange);
  if (state.modal === "pay") updatePaymentSummary();
}
function decorateReferenceSidebar() {
  const sidebar = document.querySelector(".main-sidebar");
  if (!sidebar) return;
  const user = esc(state.session?.user?.name || "Kasir");
  const nav = (page, icon, label) => `<li class="nav-item" data-sidebar-nav="${label.toLowerCase()}"><a href="#" class="nav-link ${state.page === page ? "active" : ""}" data-page="${page}"><i class="nav-icon fas ${icon}"></i><p>${label}</p></a></li>`;
  sidebar.innerHTML = `<div class="brand-link d-flex align-items-center"><img src="/server-assets/img/logo-only-white.png" class="brand-image img-circle elevation-3" style="opacity:.8" alt="De'Jati"><span class="brand-text font-weight-light"><b>De'</b>Jati</span></div><div class="sidebar"><div class="user-panel mt-3 pb-3 mb-3 d-flex"><div class="image"><img src="/server-assets/img/user-no-image-gray.png" class="img img-circle elevation-2" alt="User Image"></div><div class="info"><a href="#" class="d-block" data-action="profile-notice">${user}</a></div></div><div class="form-inline"><div class="input-group" data-widget="sidebar-search"><input id="sidebar-search" class="form-control form-control-sidebar" type="search" placeholder="Search" aria-label="Search"><div class="input-group-append"><button class="btn btn-sidebar" type="button" aria-label="Cari menu"><i class="fas fa-search fa-fw"></i></button></div></div></div><nav class="mt-2"><ul class="nav nav-pills nav-sidebar nav-legacy nav-flat nav-child-indent flex-column" data-widget="treeview" role="menu" data-accordion="false">${nav("dashboard", "fa-tachometer-alt", "Dashboard")}${nav("transaksi", "fa-cash-register", "Transaksi")}${nav("history", "fa-history", "History Transaksi")}${nav("report", "fa-calendar-day", "Closing Harian")}</ul></nav></div>`;
}
function decorateReferenceNavbar() {
  const navbar = document.querySelector(".main-header");
  if (!navbar) return;
  const menuOpen = (name) => state.navbarMenu === name ? "show" : "";
  const user = esc(state.session?.user?.name || "Kasir");
  const role = esc(state.session?.user?.role || "-");
  navbar.innerHTML = `<ul class="navbar-nav"><li class="nav-item"><a class="nav-link" href="#" data-action="sidebar" role="button" aria-label="Toggle sidebar"><i class="fas fa-bars"></i></a></li><li class="nav-item d-flex align-items-center" id="nav-header"><span class="h5 mb-0">${esc(state.page === "dashboard" ? "Dashboard" : state.page === "transaksi" ? "Transaksi Kasir" : state.page === "history" ? "History Transaksi" : "Closing Harian")}</span></li></ul><ul class="navbar-nav ml-auto"><li class="nav-item dropdown ${menuOpen("printer")}"><a class="nav-link" href="#" data-action="menu-printer" role="button" aria-label="Printer menu" title="Printer"><i class="fas fa-print"></i></a><div class="dropdown-menu dropdown-menu-right ${menuOpen("printer")}"><span class="dropdown-item dropdown-header">Bluetooth Printers</span>${navbarPrinterButton("cashier", "fa-cash-register", "Connect Cashier")}${navbarPrinterButton("kitchen", "fa-utensils", "Connect Kitchen")}<div class="dropdown-divider"></div><button type="button" class="dropdown-item" data-action="test-cashier"><i class="fas fa-receipt mr-2"></i> Test Cashier</button><button type="button" class="dropdown-item" data-action="test-kitchen"><i class="fas fa-receipt mr-2"></i> Test Kitchen</button></div></li><li class="nav-item d-flex align-items-center"><button type="button" class="nav-link btn btn-link theme-toggle" data-action="theme" aria-label="Aktifkan dark mode"></button></li><li class="nav-item ${menuOpen("search")}"><a class="nav-link" href="#" data-action="menu-search" role="button"><i class="fas fa-search"></i></a><div class="navbar-search-block ${menuOpen("search")}"><form class="form-inline" data-navbar-search><div class="input-group input-group-sm"><input class="form-control form-control-navbar" type="search" placeholder="Search" aria-label="Search"><div class="input-group-append"><button class="btn btn-navbar" type="submit"><i class="fas fa-search"></i></button><button class="btn btn-navbar" type="button" data-action="menu-search"><i class="fas fa-times"></i></button></div></div></form></div></li><li class="nav-item dropdown ${menuOpen("notification")}"><a class="nav-link" href="#" data-action="menu-notification"><i class="far fa-bell"></i><span class="badge badge-warning navbar-badge">15</span></a><div class="dropdown-menu dropdown-menu-lg dropdown-menu-right ${menuOpen("notification")}"><span class="dropdown-item dropdown-header">15 Notifications</span><div class="dropdown-divider"></div><span class="dropdown-item"><i class="fas fa-envelope mr-2"></i> 4 new messages<span class="float-right text-muted text-sm">3 mins</span></span><div class="dropdown-divider"></div><span class="dropdown-item"><i class="fas fa-users mr-2"></i> 8 friend requests<span class="float-right text-muted text-sm">12 hours</span></span><div class="dropdown-divider"></div><span class="dropdown-item"><i class="fas fa-file mr-2"></i> 3 new reports<span class="float-right text-muted text-sm">2 days</span></span><div class="dropdown-divider"></div><span class="dropdown-item dropdown-footer">See All Notifications</span></div></li><li class="nav-item"><a class="nav-link" href="#" data-action="fullscreen" role="button"><i class="fas fa-expand-arrows-alt"></i></a></li><li class="nav-item dropdown user-menu ${menuOpen("user")}"><a class="nav-link dropdown-toggle" href="#" data-action="menu-user"><i class="fas fa-cog"></i></a><div class="dropdown-menu dropdown-menu-lg dropdown-menu-right ${menuOpen("user")}"><div class="user-header bg-dark text-center p-3"><img src="/server-assets/img/user-no-image-gray.png" class="img img-circle elevation-2" alt="User Image" width="72"><p class="mb-0 mt-2">${user}</p><p><small class="text-muted">${role}</small></p></div><div class="user-footer d-flex justify-content-between p-2"><button class="btn btn-sm btn-outline-secondary" data-action="profile-notice">Profile</button><button class="btn btn-sm btn-outline-danger" data-action="logout">Log Out</button></div></div></li></ul>`;
}
function decorateReferenceToggle() {
  const toggle = document.querySelector("[data-action='theme']");
  if (!toggle) return;
  const isDark = state.theme === "dark";
  toggle.className = "nav-link btn btn-link theme-toggle";
  toggle.dataset.themeToggle = "";
  toggle.dataset.themeMode = state.theme;
  toggle.setAttribute("aria-label", isDark ? "Aktifkan light mode" : "Aktifkan dark mode");
  toggle.setAttribute("aria-pressed", String(isDark));
  toggle.title = isDark ? "Pindah ke light mode" : "Pindah ke dark mode";
  toggle.innerHTML = '<span class="theme-toggle-track" aria-hidden="true"><i class="fas fa-sun theme-toggle-icon theme-toggle-icon-sun"></i><span class="theme-toggle-thumb"></span><i class="fas fa-moon theme-toggle-icon theme-toggle-icon-moon"></i></span>';
  document.querySelectorAll(".main-header").forEach((navbar) => {
    navbar.classList.toggle("navbar-dark", isDark);
    navbar.classList.toggle("navbar-light", !isDark);
    navbar.classList.toggle("navbar-white", !isDark);
    navbar.classList.toggle("navbar-gray-dark", isDark);
  });
  document.querySelectorAll(".main-sidebar").forEach((sidebar) => {
    sidebar.classList.toggle("sidebar-dark-primary", isDark);
    sidebar.classList.toggle("sidebar-light-primary", !isDark);
  });
}
function decorateReferenceModal() {
  const modal = document.querySelector(".modal-backdrop-mobile");
  if (!modal) return;
  modal.classList.add("modal", "fade", "show");
  const dialog = modal.querySelector(".modal-dialog");
  dialog?.classList.add("modal-dialog-centered");
  if (state.modal === "item") {
    modal.id = "buyQueryModal";
    const title = modal.querySelector(".modal-title");
    if (title) title.id = "buyQueryTitle";
    const labels = modal.querySelectorAll("label");
    if (labels[0]) labels[0].textContent = "Quantity";
    if (labels[1]) labels[1].textContent = "Notes";
    if (labels[2]) labels[2].textContent = "Dine In / Take Away";
    const quantity = modal.querySelector("#item-qty");
    if (quantity) quantity.id = "buyQty";
  } else if (state.modal === "carwash") {
    modal.id = "carwashModal";
    const title = modal.querySelector(".modal-title");
    if (title) title.id = "carwashModalLabel";
  } else if (state.modal === "bill") {
    modal.id = "openBillModal";
    dialog?.classList.add("modal-lg");
    const title = modal.querySelector(".modal-title");
    if (title) title.id = "openBillModalLabel";
  }
}
function openProduct(id) {
  const product = state.products.find((item) => String(item.id) === String(id));
  if (!product) return;
  state.selected = product;
  state.editing = null;
  const serviceType = ["carwash", "detailing"].includes(String(product.cartType || product.category).toLowerCase());
  if (variants(product).length) state.modal = "variant";
  else if (serviceType) state.modal = "carwash";
  else state.modal = "item";
  render();
}
function addOrUpdate(line) {
  if (state.editing !== null) state.cart[state.editing] = line;
  else {
    const found = state.cart.find(
      (item) =>
        item.id === line.id &&
        item.name === line.name &&
        item.price === line.price &&
        item.notes === line.notes &&
        item.orderType === line.orderType &&
        !item.nopol,
    );
    if (found) found.qty += line.qty;
    else state.cart.push(line);
  }
  persist();
  state.modal = null;
  state.selected = null;
  state.editing = null;
  render();
}
async function saveOrder(data, openBill = false) {
  if (!state.cart.length) return notice("Keranjang masih kosong.", "warning");
  if (state.activeBill?.viewOnly) return notice("History transaksi paid hanya bisa dilihat.", "warning");
  state.table = data.table.trim();
  const discountPercent = Math.min(
    100,
    Math.max(0, Number(data.discount || 0)),
  );
  const discount = Math.floor((total() * discountPercent) / 100);
  const grandTotal = total() - discount;
  const paid =
    data.method === "cash"
      ? Number(String(data.paid || 0).replace(/\D/g, ""))
      : grandTotal;
  if (!state.table) return notice("Nomor meja wajib diisi.", "warning");
  if (!openBill && data.method === "cash" && paid < grandTotal)
    return notice("Uang bayar kurang.", "warning");
  const activeBill = state.activeBill;
  const localOpenBill = activeBill ? findLocalOrder(activeBill) : null;
  const existingOpenBill = localOpenBill || (activeBill ? reportingOrders().find((order) => sameOrderIdentity(order, activeBill)) : null);
  const order = existingOpenBill
    ? {
      ...existingOpenBill,
      status: openBill ? "OPEN BILL" : "PAID",
      table: state.table,
      method: openBill ? "Open Bill" : data.method,
      subtotal: total(),
      discount,
      discountPercent,
      total: openBill ? total() : grandTotal,
      paid: openBill ? 0 : paid,
      change: openBill ? 0 : Math.max(0, paid - grandTotal),
      items: cloneOrderItems(state.cart),
      synced: false,
      updatedAt: new Date().toISOString(),
      ...(openBill ? {} : { settledAt: new Date().toISOString() }),
    }
    : {
      id: crypto.randomUUID(),
      status: openBill ? "OPEN BILL" : "PAID",
      table: state.table,
      method: openBill ? "Open Bill" : data.method,
      subtotal: total(),
    discount,
    discountPercent,
    total: openBill ? total() : grandTotal,
    paid: openBill ? 0 : paid,
      change: openBill ? 0 : Math.max(0, paid - grandTotal),
      createdAt: new Date().toISOString(),
      created: new Date().toLocaleString("id-ID"),
      items: cloneOrderItems(state.cart),
      synced: false,
    };
  if (!openBill && existingOpenBill?.serverOrderId && state.session?.token) {
    if (!navigator.onLine) throw new Error("Open bill dari server perlu koneksi internet untuk mengubah status menjadi paid.");
    await api("order-settle", state.session.token, {
      method: "POST",
      body: JSON.stringify({
        id: existingOpenBill.serverOrderId,
        method: data.method,
        paid,
      }),
    });
  }
  if (localOpenBill) Object.assign(localOpenBill, order);
  else if (existingOpenBill && openBill) state.orders.unshift(order);
  else if (!existingOpenBill) state.orders.unshift(order);
  state.cart = [];
  state.activeBill = null;
  state.modal = null;
  persist();
  render();
  notice(
    openBill
      ? "Open bill tersimpan di perangkat."
      : existingOpenBill
        ? "Open bill berhasil dibayar."
      : "Transaksi tersimpan di perangkat.",
    "success",
  );
  if (!openBill) {
    setTimeout(() => void printCompletedOrder(order), 0);
    void sync(true);
  }
}
async function sync(silent = false, force = false) {
  if (!state.session?.token || state.syncing || (silent && state.modal && !force)) return;
  state.syncing = true;
  render();
  try {
    const [catalog, serverReport] = await Promise.all([
      api("catalog", state.session.token),
      api("daily-report", state.session.token),
    ]);
    if (Array.isArray(catalog.products)) state.products = catalog.products;
    if (Array.isArray(catalog.categories)) {
      state.categories = catalog.categories;
      if (!state.categories.some((category) => category.id === state.category))
        state.category = "all";
    }
    await mirrorServerData(
      [],
      catalog.products || [],
      serverReport,
      catalog.categories || [],
    );
    let uploadError = null;
    for (const order of state.orders.filter((item) => !item.synced && orderStatus(item) === "PAID")) {
      try {
      const saved = await api("orders", state.session.token, {
        method: "POST",
        body: JSON.stringify({
          client_order_id: order.id,
          created_at: order.createdAt,
          table_number: order.table,
          payment_method: order.method,
          status: order.method === "Open Bill" ? "open_bill" : "paid",
          subtotal: order.subtotal,
          discount: order.discount,
          discountPercent: order.discountPercent,
          total: order.total,
          paid: order.paid,
          change: order.change,
          items: order.items.map((item) => ({
            ...item,
            unitPrice: item.price,
            finalPrice: item.price,
          })),
        }),
      });
      await mirrorServerTransaction(order, saved.order_id);
      order.synced = true;
      order.serverOrderId = saved.order_id;
      persist();
      } catch (error) { uploadError = error; break; }
    }
    if (!uploadError && !state.orders.some(item => !item.synced && orderStatus(item) === "PAID")) await reports.syncClosings();
    const history = await api("report-history", state.session.token);
    if (!Array.isArray(history.orders)) throw new Error("Data report server tidak valid.");
    state.serverHistory = history;
    persist();
    await mirrorReportHistory(history);
    if (uploadError) throw uploadError;
    if (!silent) notice("Sinkronisasi selesai.", "success");
  } catch (error) {
    console.error("Synchronization failed:", error);
    if (error.status === 401) {
      state.session = null;
      state.products = [];
      state.categories = [];
      persist();
      render();
      notice("Sesi telah berakhir. Silakan login kembali untuk sinkronisasi katalog.", "warning");
      return;
    }
    if (!silent)
      notice(
        error.message || "Sinkronisasi gagal, data lokal tetap aman.",
        "warning",
      );
  } finally {
    state.syncing = false;
    render();
  }
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button, tr, a, [data-action]");
  if (!target) return;
  if (target.dataset.reportAction) { event.preventDefault(); await reports.click(target); return; }
  if (reports.isBusy()) return;
  if (target.tagName === "A") event.preventDefault();
  if (target.dataset.page) {
    state.page = target.dataset.page;
    state.sidebarOpen = false;
    state.historyDrawerOpen = false;
    render();
    return;
  }
  if (target.dataset.product) {
    if (!canEditCart()) {
      notice("History transaksi paid hanya bisa dilihat.", "warning");
      return;
    }
    return openProduct(target.dataset.product);
  }
  if (target.dataset.category) {
    state.category = target.dataset.category;
    updateCategoryTabs();
    updateProductList();
    return;
  }
  if (target.dataset.historyIndex !== undefined) {
    const order = todayHistoryOrders()[Number(target.dataset.historyIndex)];
    if (order) loadOrderToSummary(order);
    return;
  }
  if (target.dataset.reportDate) {
    state.reportDate = target.dataset.reportDate;
    state.modal = "report-detail";
    render();
    return;
  }
  if (target.dataset.edit !== undefined) {
    if (!canEditSummaryItems()) {
      notice("Transaksi cancel hanya bisa dilihat.", "warning");
      return;
    }
    state.editing = Number(target.dataset.edit);
    state.selected = state.cart[state.editing];
    state.modal = ["carwash", "detailing"].includes(state.selected.cartType) ? "carwash" : "item";
    render();
    return;
  }
  if (target.dataset.printerAddress) {
    void connectPrinter(target.dataset.printerAddress);
    return;
  }
  if (target.hasAttribute("data-close")) {
    state.modal = null;
    state.selected = null;
    state.editing = null;
    render();
    return;
  }
  if (target.dataset.variant !== undefined) {
    const variant = variants(state.selected)[Number(target.dataset.variant)];
    state.selected = {
      ...state.selected,
      name: `${state.selected.name} (${variant.name})`,
      price: variant.price,
      variantName: variant.name,
    };
    state.modal = ["carwash", "detailing"].includes(state.selected.cartType) ? "carwash" : "item";
    render();
    return;
  }
  if (target.dataset.qty) {
    const input = document.querySelector("#item-qty, #buyQty");
    input.value = Math.max(
      1,
      Number(input.value || 1) + Number(target.dataset.qty),
    );
    return;
  }
  const action = target.dataset.action;
  if (action === "sidebar") {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  } else if (action === "toggle-history") {
    state.historyDrawerOpen = !state.historyDrawerOpen;
    render();
  } else if (action === "close-history") {
    state.historyDrawerOpen = false;
    render();
  } else if (action === "theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    render();
  } else if (action?.startsWith("menu-")) {
    const menu = action.slice(5);
    state.navbarMenu = state.navbarMenu === menu ? "" : menu;
    render();
  } else if (action === "fullscreen") {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  } else if (action === "connect-cashier") {
    void showPrinterPicker("cashier");
  } else if (action === "connect-kitchen") {
    void showPrinterPicker("kitchen");
  } else if (action === "test-cashier" || action === "test-kitchen") {
    const type = action === "test-cashier" ? "cashier" : "kitchen";
    state.navbarMenu = "";
    render();
    void printReceipt({
      table: "TEST",
      method: "test",
      subtotal: 0,
      discount: 0,
      total: 0,
      paid: 0,
      change: 0,
      createdAt: new Date().toISOString(),
      items: [{ name: "Test printer berhasil", price: 0, qty: 1 }],
    }, type);
  } else if (action === "profile-notice") {
    state.navbarMenu = "";
    render();
    notice("Profil pengguna belum tersedia di APK ini.", "info");
  } else if (action === "sync") void sync();
  else if (action === "cancel-transaction") await cancelSummaryOrder();
  else if (action === "print-chit" || action === "print-invoice-cashier") {
    if (!state.cart.length) {
      notice("Tambahkan produk terlebih dahulu.", "warning");
      return;
    }
    const order = currentCartOrder();
    if (action === "print-chit") {
      await printReceipt(order, "kitchen", "kitchen");
      await wait(2500);
      await printReceipt(order, "cashier", "kitchen");
    }
    else await printReceipt(order, "cashier", "invoice");
  }
  else if (action === "clear") {
    if (await sweetConfirm({
      title: "Hapus list transaksi dari Order Summary?",
      confirmButtonText: "Hapus",
    })) {
      state.cart = [];
      state.activeBill = null;
      persist();
      render();
    }
  } else if (action === "pay") {
    if (!canEditCart()) {
      notice("History transaksi paid hanya bisa dilihat.", "warning");
      return;
    }
    if (!state.cart.length)
      notice("Tambahkan produk terlebih dahulu.", "warning");
    else {
      state.modal = "pay";
      render();
    }
  } else if (action === "bill") {
    if (!canEditCart()) {
      notice("History transaksi paid hanya bisa dilihat.", "warning");
      return;
    }
    if (!state.cart.length)
      notice("Tambahkan produk terlebih dahulu.", "warning");
    else {
      state.modal = "bill";
      render();
    }
  } else if (action === "remove-item") {
    state.cart.splice(state.editing, 1);
    persist();
    state.modal = null;
    state.selected = null;
    state.editing = null;
    render();
  } else if (action === "hold-carwash") {
    document.querySelector("#carwash-form").requestSubmit();
    document.querySelector("#carwash-form").dataset.hold = "true";
  } else if (action === "logout") {
    state.session = null;
    state.cart = [];
    state.activeBill = null;
    persist();
    render();
  } else if (action === "reset-report") {
    state.reportMonth = "";
    render();
  } else if (action === "print-report") window.print();
});
app.addEventListener("input", (event) => {
  reports.input(event.target);
  if (event.target.id === "product-search") {
    state.search = event.target.value;
    updateProductList();
  } else if (event.target.id === "sidebar-search") {
    const keyword = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-sidebar-nav]").forEach((item) => {
      item.hidden = Boolean(keyword) && !item.dataset.sidebarNav.includes(keyword);
    });
  }
});
app.addEventListener("change", (event) => {
  reports.change(event.target);
  if (event.target.id === "dashboardTrendRange") {
    state.dashboardRange = event.target.value;
    dashboardCanvas(document.querySelector("#dashboardTrendChart"), state.dashboardRange);
  }
  if (event.target.id === "payment-method") updatePaymentSummary();
});
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  if (await reports.submit(form)) return;
  if (form.matches("[data-navbar-search]")) {
    state.search = String(new FormData(form).get("search") || form.querySelector("input")?.value || "");
    state.page = "transaksi";
    state.navbarMenu = "";
    render();
    return;
  }
  if (form.id === "report-filter") {
    state.reportMonth = new FormData(form).get("month") || "";
    render();
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "login-form") {
      const response = await api("login", "", {
        method: "POST",
        body: JSON.stringify(data),
      });
      state.session = response;
      persist();
      await sync();
      render();
    } else if (form.id === "item-form") {
      addOrUpdate({
        ...state.selected,
        qty: Math.max(1, Number(data.qty || 1)),
        notes: data.notes || "",
        orderType: document.querySelector("#order-type").checked
          ? "dine-in"
          : "take-away",
        cartType: "product",
      });
    } else if (form.id === "carwash-form") {
      const hold = form.dataset.hold === "true";
      const vacuum = data.vacuum || "no";
      addOrUpdate({
        ...state.selected,
        price: state.selected.price + (vacuum === "yes" ? 5000 : 0),
        qty: 1,
        cartType: ["carwash", "detailing"].includes(state.selected.cartType) ? state.selected.cartType : "carwash",
        nopol: data.nopol,
        service: data.service,
        ukuran: data.ukuran,
        vacuum,
        hold,
        notes: hold
          ? `Vacuum: ${vacuum === "yes" ? "Ya" : "Tidak"}`
          : `NoPol: ${data.nopol}, Service: ${data.service}, Ukuran: ${data.ukuran}, Vacuum: ${vacuum === "yes" ? "Ya" : "Tidak"}`,
      });
    } else if (form.id === "pay-form") await saveOrder(data);
    else if (form.id === "bill-form") await saveOrder(data, true);
  } catch (error) {
    notice(error.message || "Proses gagal.", "danger");
  }
});

// Set before the bubble handler submits the form so carwash "Hold" keeps its status.
document.addEventListener(
  "click",
  (event) => {
    if (event.target.closest("[data-action='hold-carwash']"))
      document
        .querySelector("#carwash-form")
        ?.setAttribute("data-hold", "true");
    const quickPay = event.target.closest("[data-quick-pay]");
    if (quickPay) {
      document.querySelector("#customer-pay").value = formatDigits(quickPay.dataset.quickPay);
      updatePaymentSummary();
    }
  },
  true,
);
document.addEventListener("input", (event) => {
  if (event.target.id === "customer-pay") {
    event.target.value = formatDigits(event.target.value);
    event.target.setSelectionRange?.(event.target.value.length, event.target.value.length);
    updatePaymentSummary();
  } else if (event.target.id === "payment-discount")
    updatePaymentSummary();
});
document.addEventListener("change", (event) => {
  if (event.target.id === "payment-method") updatePaymentSummary();
});

initializeServerMirror()
  .then(async () => {
    const cachedHistory = await loadReportHistory();
    if (!state.serverHistory && cachedHistory) state.serverHistory = cachedHistory;
    const cachedCatalog = await loadServerCatalog();
    if (!cachedCatalog) return;
    state.products = Array.isArray(cachedCatalog.products)
      ? cachedCatalog.products
      : [];
    state.categories = Array.isArray(cachedCatalog.categories)
      ? cachedCatalog.categories
      : [];
  })
  .catch(() => undefined)
  .finally(() => {
    render();
    if (state.session?.token) void sync(true);
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("theme-preload")));
  });

window.addEventListener("online", () => void sync(true));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void sync(true);
});
setInterval(() => {
  if (!document.hidden && navigator.onLine && state.page !== "transaksi" && !state.modal) void sync(true);
}, 60000);
