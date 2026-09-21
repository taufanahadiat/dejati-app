import { exportReport } from "./reportExport.js";
import { closingRecords, dateRange, jakartaDate, localClosing, orderStatus, validateExpenses } from "./reportModel.js";

export function createReports({ state, orders, api, render, persist, notice, refresh, printReceipt, connectCashier, printText, loadOpenBill, money, esc }) {
  const ui = { ...dateRange("today"), preset: "today", month: "", year: "", search: "", page: 0, size: 25, modal: null, selected: null, preview: null, busy: false, expenses: [], reason: "", method: "cash", paid: "", pending: null, printedClosing: null };
  const pendingKey = () => `dejati-closing-request-${state.session?.user?.id || state.session?.user?.name}`;
  const readPending = () => { try { return JSON.parse(localStorage.getItem(pendingKey())); } catch { return null; } };
  const savePending = (value) => { ui.pending = value; if (value) localStorage.setItem(pendingKey(), JSON.stringify(value)); else localStorage.removeItem(pendingKey()); };
  const queuedKey = () => `dejati-closing-queue-${state.session?.user?.id || state.session?.user?.name}`;
  const queue = () => { try { return JSON.parse(localStorage.getItem(queuedKey()) || "[]"); } catch { return []; } };
  const saveQueue = rows => localStorage.setItem(queuedKey(), JSON.stringify(rows));
  async function syncClosings() {
    const pending = queue();
    for (const request of pending) {
      await post("closing-save", request);
      saveQueue(queue().filter(row => row.request_id !== request.request_id));
    }
  }
  const post = (path, body) => api(path, state.session.token, { method: "POST", body: JSON.stringify(body) });
  const badge = (order) => `<span class="badge badge-${orderStatus(order)==="PAID"?"success":orderStatus(order)==="CANCEL"?"danger":"warning"}">${esc(orderStatus(order))}</span>`;
  const btn = (action, label, color="secondary", id="") => `<button type="button" class="btn btn-sm btn-${color} mr-1 mb-1" data-report-action="${action}" ${id?`data-order-id="${esc(id)}"`:""} ${ui.busy?"disabled":""}>${label}</button>`;
  const table = (heads, rows, empty) => `<div class="table-responsive"><table class="table table-bordered table-striped table-hover"><thead class="thead-dark"><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="text-center text-muted py-4">${empty}</td></tr>`}</tbody></table></div>`;
  const wrap = (title, content) => `<section class="content pt-3"><div class="container-fluid"><div class="card card-outline card-dark"><div class="card-header"><h4 class="mb-0">${title}</h4></div><div class="card-body">${content}</div></div></div></section>`;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cached = () => `<small class="text-muted d-block mb-3">${state.serverHistory?.synced_at?`Terakhir diperbarui: ${esc(new Date(state.serverHistory.synced_at).toLocaleString("id-ID"))}`:"Data server belum tersinkronisasi."} ${navigator.onLine?"":"• Offline — menampilkan data tersimpan."}</small>`;
  const totals = (sales, expenses) => `<div class="row mb-3">${[["Total Penjualan",sales,"info"],["Total Pengeluaran",expenses,"danger"],["Saldo Bersih",sales-expenses,"success"]].map(([label,value,color])=>`<div class="col-md-4"><div class="small-box bg-${color}"><div class="inner"><h4>${money(value)}</h4><p>${label}</p></div></div></div>`).join("")}</div>`;
  const expenseTable = (expenses) => table(["Keterangan","Nominal"],expenses.map(e=>`<tr><td>${esc(e.keterangan)}</td><td>${money(e.total)}</td></tr>`).join(""),"Tidak ada pengeluaran.");
  const summary = (c) => `${totals(c.total_penjualan,c.total_expenses)}<h6>Ringkasan Transaksi Lunas</h6>${table(["Cash","QRIS","Kartu Kredit","Cafe","Carwash"],`<tr>${[c.cash,c.qris,c.card,c.cafe,c.carwash].map(v=>`<td>${money(v)}</td>`).join("")}</tr>`,"")}<h6>Pengeluaran</h6>${expenseTable(c.expenses || [])}`;
  function historyRows() {
    return orders().filter(o=> {
      const date=jakartaDate(o.createdAt || new Date());
      return date>=ui.start && date<=ui.end && `${o.table} ${o.method} ${orderStatus(o)} ${o.total}`.toLowerCase().includes(ui.search.toLowerCase());
    });
  }
  function historyView() {
    const all=historyRows();
    const pages=Math.max(1,Math.ceil(all.length/ui.size)); ui.page=Math.min(ui.page,pages-1);
    const rows=all.slice(ui.page*ui.size,(ui.page+1)*ui.size).map(o=>`<tr><td class="text-nowrap">${esc(new Date(o.createdAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"}))}</td><td>${esc(o.table)}</td><td>${badge(o)}${!o.synced?'<small class="d-block text-muted">Tersimpan di perangkat</small>':""}</td><td>${esc(String(o.method || "-").replaceAll("_"," "))}</td><td>${money(o.total)}</td><td>${money(o.paid)}</td><td>${money(o.change)}</td><td style="min-width:220px">${btn("detail","View","info",o.id)}${btn("invoice","Print Invoice","primary",o.id)}${btn("chit","Print Chit","warning",o.id)}${orderStatus(o)==="OPEN BILL"?btn("settle","Transact","success",o.id):""}${orderStatus(o)!=="CANCEL"?btn("cancel","Cancel","danger",o.id):""}</td></tr>`).join("");
    return wrap("History Transaksi",`${cached()}<form id="history-filter" class="row align-items-end mb-3"><div class="col-md-3"><label>Report Range</label><select name="preset" class="form-control">${[["today","Today"],["week","This Week (Mon–Sun)"],["month","This Month"],["custom","Custom"]].map(([v,l])=>`<option value="${v}" ${ui.preset===v?"selected":""}>${l}</option>`).join("")}</select></div><div class="col-md-2"><label>Start Date</label><input name="start" type="date" class="form-control" value="${ui.start}" required></div><div class="col-md-2"><label>End Date</label><input name="end" type="date" class="form-control" value="${ui.end}" required></div><div class="col-md-5 mt-2"><button class="btn btn-primary mr-1">Apply</button>${btn("today","Today")}${btn("preview","Closing Hari Ini","info")}</div></form><small class="text-muted d-block mb-2">Showing transactions from ${ui.start} to ${ui.end}.</small><div class="d-flex flex-wrap justify-content-between mb-2"><div>${btn("csv","CSV")}${btn("excel","Excel")}${btn("pdf","PDF")}${btn("refresh","Refresh","outline-primary")}</div><form id="history-search" class="form-inline"><label class="mr-2">Search:</label><input name="search" class="form-control form-control-sm" value="${esc(ui.search)}"><button class="btn btn-sm btn-secondary ml-1">Cari</button></form></div>${table(["Date","Table","Status","Payment","Total","Paid","Change","Details"],rows,"Belum ada transaksi untuk rentang ini.")}<div class="d-flex justify-content-between align-items-center"><small>${all.length?ui.page*ui.size+1:0}–${Math.min(all.length,(ui.page+1)*ui.size)} dari ${all.length} transaksi</small><div>${btn("prev","Previous")}<span class="mr-2">${ui.page+1} / ${pages}</span>${btn("next","Next")}</div></div>`);
  }
  function closingView() {
    const all=[...queue().map((row,i)=>({...row.closing,id:`local-${i}`,local:true})),...(state.serverHistory?.closings || [])];
    const rows=closingRecords(all,ui.month,ui.year);
    const months=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const years=[...new Set(all.map(r=>r.tanggal.slice(0,4)))].sort().reverse();
    const filter=`<form id="closing-filter" class="form-inline mb-3"><select name="month" class="form-control form-control-sm mr-2" aria-label="Filter bulan"><option value="">Semua Bulan</option>${months.map((name,i)=>{const value=String(i+1).padStart(2,"0");return `<option value="${value}" ${ui.month===value?"selected":""}>${name}</option>`;}).join("")}</select><select name="year" class="form-control form-control-sm mr-2" aria-label="Filter tahun"><option value="">Semua Tahun</option>${years.map(y=>`<option ${ui.year===y?"selected":""}>${y}</option>`).join("")}</select><button class="btn btn-primary btn-sm mr-2">Filter</button>${btn("reset-closing","Reset","outline-secondary")}${btn("refresh","Refresh","outline-primary")}</form>`;
    return wrap("Closing Harian",`<p class="text-muted">Satu rekap terbaru untuk setiap tanggal closing.</p>${cached()}${filter}${totals(rows.reduce((s,r)=>s+Number(r.total_penjualan),0),rows.reduce((s,r)=>s+Number(r.total_expenses),0))}${table(["Tanggal","Total Penjualan","Cash","QRIS","Kartu","Cafe","Carwash","Pengeluaran","Saldo Bersih","Detail"],rows.map(r=>`<tr><td>${esc(r.tanggal.split("-").reverse().join("-"))}${r.local?'<small class="d-block text-warning">Menunggu sinkronisasi</small>':""}</td>${[r.total_penjualan,r.cash,r.qris,r.card,r.cafe,r.carwash].map(v=>`<td>${money(v)}</td>`).join("")}<td><span class="badge badge-danger">${money(r.total_expenses)}</span></td><td><strong>${money(r.net)}</strong></td><td>${r.expenses?.length?btn("closing-detail","Lihat","info",String(r.id)):"-"}</td></tr>`).join(""),"Belum ada data closing untuk filter ini.")}`);
  }
  function modal() {
    if (!ui.modal) return "";
    let title="", body="", footer=btn("close","Tutup"), form="";
    const o=ui.selected;
    if (ui.modal==="detail") {
      title=`Detail Transaksi — ${o.table}`;
      body=`<p>${badge(o)} • ${esc(new Date(o.createdAt).toLocaleString("id-ID"))}</p>${table(["Item","Qty","Harga","Total"],o.items.map(i=>`<tr><td>${esc(i.name)}${i.nopol?`<small class="d-block">${esc(i.nopol)} ${esc(i.service || "")}</small>`:""}${i.notes?`<small class="d-block">${esc(i.notes)}</small>`:""}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.lineTotal ?? i.price*i.qty)}</td></tr>`).join(""),"Tidak ada item.")}<p>Total: <strong>${money(o.total)}</strong> • Bayar: ${money(o.paid)} • Kembali: ${money(o.change)}</p>${o.cancelReason?`<p>Alasan cancel: ${esc(o.cancelReason)}</p>`:""}`;
    } else if (ui.modal==="closing-detail") {
      title=`Detail Pengeluaran (${o.tanggal})`; body=expenseTable(o.expenses);
    } else if (ui.modal==="cancel") {
      title="Cancel Order"; form="report-cancel";
      body=`<p>Meja: <strong>${esc(o.table)}</strong> • Total: ${money(o.total)}</p><label>Alasan Cancel</label><textarea class="form-control" name="reason" required maxlength="5000" ${ui.busy?"disabled":""}>${esc(ui.reason)}</textarea>`;
      footer=`${footer}<button class="btn btn-danger" ${ui.busy?"disabled":""}>${ui.busy?"Memproses...":"Cancel Order"}</button>`;
    } else if (ui.modal==="settle") {
      title="Transact — Open Bill"; form="report-settle";
      body=`<p>Meja: <strong>${esc(o.table)}</strong> • Total: <strong>${money(o.total)}</strong></p><label>Metode Pembayaran</label><select class="form-control mb-3" name="method">${[["cash","Cash"],["qris","QRIS"],["credit_card","Kartu Kredit"]].map(([v,l])=>`<option value="${v}" ${ui.method===v?"selected":""}>${l}</option>`).join("")}</select><label>Bayar</label><input class="form-control" name="paid" type="number" step="1" min="${o.total}" value="${esc(ui.paid)}" ${ui.method!=="cash"?"readonly":""} required>`;
      footer=`${footer}<button class="btn btn-success" ${ui.busy?"disabled":""}>${ui.busy?"Memproses...":"Bayar & Cetak"}</button>`;
    } else if (ui.modal==="preview") {
      title="Preview Closing Harian";
      body=ui.preview?`<p>Tanggal: ${esc(ui.preview.tanggal)}</p>${summary(ui.preview)}`:'<p>Memuat data...</p>';
      if (ui.preview) {
        body+=`<hr><h6>Apakah ada pengeluaran hari ini?</h6>${ui.pending?'<p class="text-warning">Permintaan sebelumnya belum terkonfirmasi. Coba kembali untuk memeriksa hasilnya.</p>':""}<div>${ui.expenses.map((e,i)=>`<div class="row mb-2"><div class="col-6"><input class="form-control" placeholder="Keterangan" aria-label="Keterangan pengeluaran" data-expense="${i}" name="keterangan" value="${esc(e.keterangan)}" ${ui.busy||ui.pending?"disabled":""}></div><div class="col-4"><input class="form-control" type="number" min="1" step="1" placeholder="Nominal" aria-label="Nominal pengeluaran" data-expense="${i}" name="total" value="${esc(e.total)}" ${ui.busy||ui.pending?"disabled":""}></div><div class="col-2">${!ui.pending?btn("remove-expense","×","danger",String(i)):""}</div></div>`).join("")}</div>${!ui.pending?btn("add-expense","+ Tambah Pengeluaran","outline-primary"):""}`;
        footer=`${footer}${btn("save-closing",ui.busy?"Memproses...":"Simpan & Cetak","success")}${ui.printedClosing?btn("reprint-closing","Cetak Ulang","info"):""}`;
      }
    }
    return `<div class="modal-backdrop-mobile report-modal"><div class="modal-dialog modal-lg"><${form?`form id="${form}"`:"div"} class="modal-content"><div class="modal-header bg-info text-white"><h5 class="modal-title">${esc(title)}</h5>${btn("close","×")}</div><div class="modal-body">${body}</div><div class="modal-footer">${footer}</div></${form?"form":"div"}></div></div>`;
  }
  async function run(fn) {
    if (ui.busy) return;
    ui.busy=true; render();
    try { await fn(); }
    catch(error) { notice(error.message || "Gagal memproses laporan.","danger"); }
    finally { ui.busy=false; render(); }
  }
  function online() { if (!navigator.onLine) throw new Error("Aksi ini memerlukan koneksi server. Data tersimpan tetap bisa dilihat saat offline."); }
  async function preview() {
    const date=jakartaDate(new Date());
    if (navigator.onLine) await refresh().catch(() => undefined);
    const existing=queue().find(row=>row.date===date);
    ui.pending=existing || readPending(); ui.expenses=ui.pending?.expenses || [];
    ui.preview=existing?.closing || localClosing(orders(),date,[]);
    ui.printedClosing=null; ui.modal="preview"; state.modal="reports";
  }
  function closingText(c) {
    return ['\x1B\x40\x1B\x61\x01',"Dejati Coffee Garden","Laporan Closing Harian",`Tanggal: ${c.tanggal}`,'\x1B\x61\x00',"--------------------------------",...[["Total Penjualan",c.total_penjualan],["Cash",c.cash],["QRIS",c.qris],["Kartu Kredit",c.card],["Cafe",c.cafe],["Carwash",c.carwash]].map(([k,v])=>`${k}: ${money(v)}`),"--------------------------------","Pengeluaran [-]",...(c.expenses.length?c.expenses.map(e=>`${e.keterangan}: ${money(e.total)}`):["Tidak ada pengeluaran"]),"--------------------------------",`Saldo Bersih: ${money(c.net)}`,"Terima kasih!\n\n\n\x1D\x56\x00"].join("\n");
  }
  async function saveClosing() {
    const expenses=validateExpenses(ui.expenses);
    const closing=localClosing(orders(),ui.preview.tanggal,expenses);
    const request=ui.pending || { request_id:crypto.randomUUID(),date:closing.tanggal,expenses,closing };
    if (!queue().some(row=>row.request_id===request.request_id)) saveQueue([...queue(),request]);
    savePending(null); ui.pending=request; ui.preview=closing; ui.printedClosing=closing;
    try { await connectCashier(); await printText(closingText(closing)); notice("Closing dicetak dan tersimpan lokal. Sinkronisasi otomatis saat server tersedia.","success"); }
    catch(error) { throw new Error(`Closing sudah tersimpan. Cetak gagal: ${error.message}. Gunakan Cetak Ulang.`); }
    if (navigator.onLine) void refresh().catch(()=>undefined);
  }
  function exportRows() {
    return [["Date","Table","Status","Payment","Total","Paid","Change"],...historyRows().map(o=>[new Date(o.createdAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta"}),o.table,orderStatus(o),o.method,o.total,o.paid,o.change])];
  }
  async function click(target) {
    const action=target.dataset.reportAction;
    if (!action) return false;
    if (ui.busy) return true;
    const id=target.dataset.orderId;
    if (["detail","invoice","chit","settle","cancel"].includes(action)) {
      ui.selected=orders().find(o=>o.id===id); if (!ui.selected) return true;
      if (action==="invoice") { await printReceipt(ui.selected,"cashier","invoice"); return true; }
      if (action==="chit") {
        await printReceipt(ui.selected,"cashier","kitchen");
        await wait(2500);
        await printReceipt(ui.selected,"kitchen","kitchen");
        return true;
      }
      if (action==="detail" && orderStatus(ui.selected)==="OPEN BILL" && loadOpenBill) {
        ui.modal=null; state.modal=null;
        return loadOpenBill(ui.selected);
      }
      ui.reason=""; ui.method="cash"; ui.paid=String(ui.selected.total); ui.modal=action; state.modal="reports";
    } else if (action==="closing-detail") {
      ui.selected=[...queue().map((row,i)=>({...row.closing,id:`local-${i}`})),...(state.serverHistory?.closings || [])].find(c=>String(c.id)===id); if (!ui.selected) return true;
      ui.modal=action; state.modal="reports";
    } else if (action==="close") { ui.modal=null; state.modal=null; }
    else if (action==="preview") { await run(preview); return true; }
    else if (action==="save-closing") { await run(saveClosing); return true; }
    else if (action==="reprint-closing") { await run(async()=>{await connectCashier();await printText(closingText(ui.printedClosing));notice("Closing dikirim ke printer.","success");});return true; }
    else if (action==="add-expense") ui.expenses.push({keterangan:"",total:""});
    else if (action==="remove-expense") ui.expenses.splice(Number(id),1);
    else if (action==="today") { Object.assign(ui,dateRange("today"),{preset:"today",page:0}); }
    else if (action==="reset-closing") { ui.month="";ui.year=""; }
    else if (action==="refresh") { await run(async()=>{online();await refresh();});return true; }
    else if (action==="prev") ui.page=Math.max(0,ui.page-1);
    else if (action==="next") ui.page++;
    else if (action==="copy") { await run(async()=>{await navigator.clipboard.writeText(exportRows().map(r=>r.join("\t")).join("\n"));notice("Data disalin.","success");});return true; }
    else if (["csv","excel","pdf"].includes(action)) {
      await run(async()=>{ await exportReport(action,exportRows(),`History_Transaksi_${ui.start}_to_${ui.end}`,`History Transaksi ${ui.start} to ${ui.end}`); });return true;
    }
    render();return true;
  }
  async function submit(form) {
    if (!["history-filter","history-search","closing-filter","report-cancel","report-settle"].includes(form.id)) return false;
    const data=Object.fromEntries(new FormData(form));
    if (form.id==="history-filter") { ui.start=data.start;ui.end=data.end;if(ui.start>ui.end)[ui.start,ui.end]=[ui.end,ui.start];ui.preset=data.preset;ui.page=0;render(); }
    else if(form.id==="history-search") { ui.search=data.search;ui.page=0;render(); }
    else if(form.id==="closing-filter") { ui.month=data.month;ui.year=data.year;render(); }
    else await run(async()=>{
      const o=ui.selected;
      const canceled=form.id==="report-cancel";
      let paid=Number(data.paid);
      if (!canceled && data.method!=="cash") paid=Number(o.total);
      if (!canceled && (!Number.isSafeInteger(paid)||paid<o.total)) throw new Error("Uang bayar kurang atau tidak valid.");
      if(canceled&&!data.reason.trim()) throw new Error("Isi alasan pembatalan.");
      if(o.serverOrderId) {
        online();
        await post(canceled?"order-cancel":"order-settle",{id:o.serverOrderId,reason:data.reason,method:data.method,paid});
      }
      const local=state.orders.find(row=>row.id===o.id || row.id===o.clientOrderId || (row.serverOrderId && row.serverOrderId===o.serverOrderId));
      const update=canceled?{status:"CANCEL",cancelReason:data.reason}:{status:"PAID",method:data.method,paid,change:paid-o.total};
      Object.assign(o,update);if(local)Object.assign(local,update);
      persist();ui.modal=null;state.modal=null;
      notice(canceled?"Status order berhasil diubah menjadi CANCEL.":"Pembayaran tersimpan.","success");
      if(navigator.onLine)await refresh();
      if(!canceled)await printReceipt(o);
    });
    return true;
  }
  function input(el) {
    if (el.dataset.expense!==undefined) { ui.expenses[Number(el.dataset.expense)][el.name]=el.value; }
    if(el.closest("#report-cancel"))ui.reason=el.value;
    if(el.closest("#report-settle"))ui[el.name]=el.value;
  }
  function change(el) {
    if(el.closest("#history-filter")) {
      const form=el.form;
      if(el.name==="preset" && el.value!=="custom") { const range=dateRange(el.value);form.elements.start.value=range.start;form.elements.end.value=range.end; }
      else if(el.name!=="preset")form.elements.preset.value="custom";
    }
    if(el.closest("#report-settle")&&el.name==="method") {ui.method=el.value;ui.paid=String(ui.selected.total);render();}
  }
  return { view:page=>page==="history"?historyView():closingView(),modal,click,submit,input,change,syncClosings,isBusy:()=>ui.busy };
}
