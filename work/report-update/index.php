<?php
date_default_timezone_set("Asia/Jakarta");

$breadcrumb = [
    ['label' => 'History Transaksi', 'link' => '#'],
];

function normalizeReportDate($date, $fallback)
{
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$date) ? $date : $fallback;
}

$allowedReportRanges = ['today', 'week', 'month', 'custom'];
$reportRange = $_GET['range'] ?? 'today';
$reportRange = in_array($reportRange, $allowedReportRanges, true) ? $reportRange : 'today';

$today = date('Y-m-d');
$startFilter = normalizeReportDate($_GET['start'] ?? '', $today);
$endFilter = normalizeReportDate($_GET['end'] ?? '', $today);

if (strtotime($startFilter) > strtotime($endFilter)) {
    [$startFilter, $endFilter] = [$endFilter, $startFilter];
}

$startDate = $startFilter . ' 00:00:00';
$endDate = $endFilter . ' 23:59:59';

$stmt = $conn->prepare("SELECT id, table_number, payment_method, total_amount, paid_amount, change_amount, created_at,
                               COALESCE(NULLIF(status_order, ''), CASE WHEN paid_amount = 0 THEN 'OPEN BILL' ELSE 'PAID' END) AS status_order
                        FROM orders
                        WHERE created_at BETWEEN ? AND ?
                        ORDER BY created_at DESC");
$stmt->bind_param('ss', $startDate, $endDate);
$stmt->execute();
$result = $stmt->get_result();
?>

<!-- Flatpickr DateTime Picker -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css">
<script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>

<style>
    #ordersTable_wrapper .dt-buttons.btn-group,
    #ordersTable_wrapper .dt-buttons.btn-group .btn,
    #ordersTable_wrapper .dt-buttons .btn,
    #ordersTable_wrapper .dt-button-collection,
    #ordersTable_wrapper .dt-button-collection .dropdown-item,
    #ordersTable_wrapper .dt-button-collection .dt-button,
    #ordersTable_wrapper .dt-button-collection .buttons-columnVisibility,
    #ordersTable_wrapper .pagination .page-link,
    #ordersTable_wrapper .pagination .page-item:first-child .page-link,
    #ordersTable_wrapper .pagination .page-item:last-child .page-link,
    #ordersTable_wrapper .col-md-7 .pagination .page-link {
        border-radius: 0 !important;
    }
</style>

<!-- Content Wrapper -->
<section class="content">
    <div class="row">
        <div class="col-12">
            <div class="card card-outline card-dark">
                <div class="card-body">
                    <small class="text-muted d-block mb-2">Showing transactions from <?= htmlspecialchars($startFilter) ?> to <?= htmlspecialchars($endFilter) ?>.</small>

                    <div class="row mb-3 align-items-end">
                        <div class="col-md-3">
                            <label for="reportPreset"><strong>Report Range</strong></label>
                            <select id="reportPreset" class="form-control">
                                <option value="today" <?= $reportRange === 'today' ? 'selected' : '' ?>>Today</option>
                                <option value="week" <?= $reportRange === 'week' ? 'selected' : '' ?>>This Week (Mon-Sun)</option>
                                <option value="month" <?= $reportRange === 'month' ? 'selected' : '' ?>>This Month</option>
                                <option value="custom" <?= $reportRange === 'custom' ? 'selected' : '' ?>>Custom</option>
                            </select>
                        </div>
                        <div class="col-md-2">
                            <label for="startDate"><strong>Start Date</strong></label>
                            <input type="text" id="startDate" class="form-control" value="<?= htmlspecialchars($startFilter) ?>">
                        </div>
                        <div class="col-md-2">
                            <label for="endDate"><strong>End Date</strong></label>
                            <input type="text" id="endDate" class="form-control" value="<?= htmlspecialchars($endFilter) ?>">
                        </div>
                        <div class="col-md-2">
                            <button id="applyDateFilter" class="btn btn-primary btn-block mt-4">
                                <i class="fas fa-filter"></i> Apply
                            </button>
                        </div>
                        <div class="col-md-1">
                            <button id="resetFilter" class="btn btn-outline-secondary btn-block mt-4">
                                <i class="fas fa-undo"></i> Today
                            </button>
                        </div>
                        <div class="col-md-2 text-right">
                            <button id="printClosinganBtn" class="btn btn-info mt-4">
                                <i class="fas fa-cash-register"></i> Closing Hari Ini
                            </button>
                        </div>
                    </div>
<!-- Modal -->
<div class="modal fade" id="closinganModal" tabindex="-1" role="dialog" aria-labelledby="closinganModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-lg" role="document">
    <div class="modal-content">
      <div class="modal-header bg-info text-white">
        <h5 class="modal-title">Preview Closing Harian</h5>
        <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
      </div>
      <div class="modal-body">
        <div id="closinganPreview" class="p-2 border rounded bg-light">
          <p>Loading data...</p>
        </div>

        <hr>
        <h6>Apakah ada pengeluaran hari ini?</h6>
        <div id="pengeluaranList"></div>

        <button id="addPengeluaran" class="btn btn-outline-primary btn-sm mt-2">+ Tambah Pengeluaran</button>
      </div>
      <div class="modal-footer">
        <button id="confirmPrintClosingan" class="btn btn-success">Simpan & Cetak</button>
        <button class="btn btn-secondary" data-dismiss="modal">Tutup</button>
      </div>
    </div>
  </div>
</div>

                    <!-- Orders table -->
                    <table id="ordersTable" class="table table-bordered table-striped">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Table</th>
                                <th>Status</th>
                                <th>Payment</th>
                                <th>Total</th>
                                <th>Paid</th>
                                <th>Change</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php while ($row = mysqli_fetch_assoc($result)): ?>
                                <tr>
                                    <td><?= $row['created_at'] ?></td>
                                    <td><?= $row['table_number'] ?></td>
                                    <td>
                                        <?php
                                        $statusOrder = strtoupper((string)($row['status_order'] ?? 'PAID'));
                                        $statusClass = 'badge-success';
                                        if ($statusOrder === 'OPEN BILL') {
                                            $statusClass = 'badge-warning';
                                        } elseif ($statusOrder === 'CANCEL') {
                                            $statusClass = 'badge-danger';
                                        }
                                        ?>
                                        <span class="badge <?= $statusClass; ?>"><?= htmlspecialchars($statusOrder) ?></span>
                                    </td>
                                    <td><?= $row['payment_method'] ? ucfirst(str_replace('_', ' ', $row['payment_method'])) : '-' ?></td>
                                    <td><?= number_format($row['total_amount'], 0, ",", ".") ?></td>
                                    <td><?= number_format($row['paid_amount'], 0, ",", ".") ?></td>
                                    <td><?= number_format($row['change_amount'], 0, ",", ".") ?></td>
                                    <td>
                                        <button class="btn btn-sm btn-info view-details" data-id="<?= $row['id'] ?>">
                                            <i class="fas fa-eye"></i> View
                                        </button>
                                        <button class="btn btn-sm btn-primary print-invoice" data-id="<?= $row['id'] ?>">
                                            <i class="fas fa-print"></i> Print Invoice
                                        </button>
                                        <button class="btn btn-sm btn-warning print-chit" data-id="<?= $row['id'] ?>">
                                            <i class="fas fa-receipt"></i> Print Chit
                                        </button>
                                        <?php if ($statusOrder === 'OPEN BILL'): ?>
                                            <button id="btnTransact" class="btn btn-sm btn-success transact" data-id="<?= $row['id'] ?>">
                                                <i class="fas fa-cash-register"></i> Transact
                                            </button>
                                        <?php endif; ?>
                                        <?php if ($statusOrder !== 'CANCEL'): ?>
                                            <button class="btn btn-sm btn-danger cancel-order" data-id="<?= $row['id'] ?>" data-table="<?= htmlspecialchars($row['table_number'], ENT_QUOTES) ?>">
                                                <i class="fas fa-times-circle"></i> Cancel
                                            </button>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endwhile; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</section>

<!-- Details modal -->
<div class="modal fade" id="detailsModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header bg-info">
                <h5 class="modal-title">Order Details</h5>
                <button type="button" class="close" data-dismiss="modal">&times;</button>
            </div>
            <div class="modal-body" id="modalContent">
                <p class="text-center">Loading...</p>
            </div>
        </div>
    </div>
</div>

<!-- Required scripts -->
<div class="modal fade" id="cancelOrderModal" tabindex="-1">
  <div class="modal-dialog modal-md">
    <div class="modal-content">
      <div class="modal-header bg-danger text-white">
        <h5 class="modal-title">Cancel Order</h5>
        <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
      </div>
      <div class="modal-body">
        <form id="cancelOrderForm">
          <input type="hidden" id="cancel_order_id">
          <div class="form-group">
            <label>Table Number</label>
            <input type="text" class="form-control" id="cancel_order_table" readonly>
          </div>
          <div class="form-group mb-0">
            <label for="cancel_order_reason">Reason</label>
            <textarea class="form-control" id="cancel_order_reason" rows="4" maxlength="500" placeholder="Tulis alasan cancel order..." required></textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
        <button type="button" class="btn btn-danger" id="confirmCancelOrder">
          <i class="fas fa-times-circle"></i> Confirm Cancel
        </button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="transactModal" tabindex="-1">
  <div class="modal-dialog modal-md">
    <div class="modal-content">
      <div class="modal-header bg-success">
        <h5 class="modal-title">Finalize Transaction</h5>
        <button type="button" class="close" data-dismiss="modal">&times;</button>
      </div>
      <div class="modal-body">
        <form id="transactForm">
          <input type="hidden" name="id" id="transact_id">
          <div class="form-group">
            <label>Total Amount</label>
            <input type="text" class="form-control" id="transact_total" readonly>
          </div>
          <div class="form-group">
            <label>Payment Method</label>
            <select class="form-control" id="transact_method" required>
              <option value="cash">Cash</option>
              <option value="qris">QRIS</option>
              <option value="debit">Debit</option>
            </select>
          </div>
          <div class="form-group">
            <label>Paid Amount</label>
            <input type="number" class="form-control" id="transact_paid" required>
          </div>
          <div class="form-group">
            <label>Change</label>
            <input type="text" class="form-control" id="transact_change" readonly>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-success" id="confirmTransact">
          <i class="fas fa-check"></i> Confirm & Print
        </button>
      </div>
    </div>
  </div>
</div>



<!-- JS -->
<script src="../../plugins/jquery/jquery.min.js"></script>
<script src="../../plugins/bootstrap/js/bootstrap.bundle.min.js"></script>
<script src="../../plugins/datatables/jquery.dataTables.min.js"></script>
<script src="../../plugins/datatables-bs4/js/dataTables.bootstrap4.min.js"></script>
<script src="../../plugins/datatables-responsive/js/dataTables.responsive.min.js"></script>
<script src="../../plugins/datatables-buttons/js/dataTables.buttons.min.js"></script>
<script src="../../plugins/datatables-buttons/js/buttons.bootstrap4.min.js"></script>
<script src="../../plugins/jszip/jszip.min.js"></script>
<script src="../../plugins/pdfmake/pdfmake.min.js"></script>
<script src="../../plugins/pdfmake/vfs_fonts.js"></script>
<script src="../../plugins/datatables-buttons/js/buttons.html5.min.js"></script>


<script>
$(function () {
  // === PRINT CLOSINGAN BUTTON ===
  $('#printClosinganBtn').on('click', function () {
    $('#closinganModal').modal('show');
    loadClosinganData();
  });

  // === LOAD DATA PREVIEW ===
  function loadClosinganData() {
    $('#closinganPreview').html('<p>Loading...</p>');
    $.get('/include/report/closingan_preview.php')
      .done(function (data) { $('#closinganPreview').html(data); })
      .fail(function (xhr) {
        $('#closinganPreview').html(`<div class="alert alert-danger mb-0">${xhr.responseText || 'Gagal memuat preview closing.'}</div>`);
      });
  }

  // === ADD PENGELUARAN INPUT FIELD ===
  $('#addPengeluaran').on('click', function () {
    $('#pengeluaranList').append(`
      <div class="input-group mb-2 pengeluaran-item">
        <input type="text" class="form-control keterangan" placeholder="Keterangan">
        <input type="number" class="form-control total" placeholder="Total (Rp)">
        <div class="input-group-append">
          <button class="btn btn-danger remove-pengeluaran" type="button">&times;</button>
        </div>
      </div>
    `);
  });

  // === REMOVE PENGELUARAN ROW ===
  $(document).on('click', '.remove-pengeluaran', function () {
    $(this).closest('.pengeluaran-item').remove();
  });

  // === PRINT & SAVE CLOSINGAN ===
  $("#confirmPrintClosingan").on("click", async function () {
    const $button = $(this);
    const pengeluaran = [];
    let invalidExpense = false;

    $('.pengeluaran-item').each(function () {
      const keterangan = $(this).find('.keterangan').val().trim();
      const total = $(this).find('.total').val();
      if (keterangan && total) {
        pengeluaran.push({ keterangan, total });
      } else if (keterangan || total) {
        invalidExpense = true;
      }
    });

    if (invalidExpense) {
      Swal.fire({ icon: 'warning', title: 'Data Belum Lengkap', text: 'Lengkapi keterangan dan nominal pengeluaran, atau hapus baris yang kosong.' });
      return;
    }

    $button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');
    try {
      if (!window.getReportPrinter) { throw new Error('Printer helper is not ready. Please reload this page.'); }
      await window.getReportPrinter('cashier');

      await $.ajax({
        url: '/include/report/pengeluaran.php',
        method: 'POST',
        dataType: 'json',
        data: { data: JSON.stringify(pengeluaran) }
      });
      $('#pengeluaranList').empty();

      const escpos = await $.ajax({
        url: '/include/report/closingan_preview.php',
        method: 'POST',
        dataType: 'text',
        data: { save: '1' }
      });
      if (!window.writeReportPrinter) {
        throw new Error('Printer helper is not ready. Please reload this page.');
      }
      await window.writeReportPrinter('cashier', escpos);
      $('#closinganModal').modal('hide');
      Swal.fire({ icon: 'success', title: 'Closing Tersimpan', text: 'Rekap diperbarui dan berhasil dikirim ke printer kasir.' });
    } catch (error) {
      const message = error.responseJSON?.message || error.responseText || error.message || 'Closing harian gagal diproses.';
      Swal.fire({ icon: 'error', title: 'Closing Gagal', text: message });
    } finally {
      $button.prop('disabled', false).html('Simpan & Cetak');
    }
  });
});
</script>


<script>
    $(function() {        
$(function(){
  // Delegate click: each row's .transact has data-id
  $(document).on('click', '.transact', function (e) {
    e.preventDefault();
    const orderId = $(this).data('id');
    if (!orderId) return alert('No order id');

    // Fetch JSON from server endpoint
    $.get('/include/report/order_get_json', { id: orderId })
      .done(function (data) {
        // create a form and POST JSON to the transaksi page (browser navigation)
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/main?id=transaksi';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'order_details';
        input.value = JSON.stringify(data);
        form.appendChild(input);

        // also send order id and optionally totals if you want
        const idInput = document.createElement('input');
        idInput.type = 'hidden';
        idInput.name = 'order_id';
        idInput.value = orderId;
        form.appendChild(idInput);

        document.body.appendChild(form);
        form.submit();
      });
  });
});

        const reportRange = <?= json_encode($reportRange) ?>;
        const reportStartDate = <?= json_encode($startFilter) ?>;
        const reportEndDate = <?= json_encode($endFilter) ?>;
        const reportTitle = `History Transaksi ${reportStartDate} to ${reportEndDate}`;
        const reportFileName = `History_Transaksi_${reportStartDate}_to_${reportEndDate}`;
        const exportOptions = { columns: [0, 1, 2, 3, 4, 5, 6] };

        let table = $("#ordersTable").DataTable({
            responsive: true,
            lengthChange: true,
            deferRender: true,
            pageLength: 25,
            lengthMenu: [[10, 25, 50, 100], [10, 25, 50, 100]],
            autoWidth: false,
            buttons: [
                { extend: "csv", text: "CSV", title: reportTitle, filename: reportFileName, exportOptions },
                { extend: "excel", text: "Excel", title: reportTitle, filename: reportFileName, exportOptions },
                { extend: "pdf", text: "PDF", title: reportTitle, filename: reportFileName, exportOptions }
            ],
            order: [[0, "desc"]]
        });

        table.buttons().container().appendTo('#ordersTable_wrapper .col-md-6:eq(0)');

        function formatReportDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            return `${year}-${month}-${day}`;
        }

        function getPresetRange(preset) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (preset === "week") {
                const monday = new Date(today);
                monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
                const sunday = new Date(monday);
                sunday.setDate(monday.getDate() + 6);
                return [formatReportDate(monday), formatReportDate(sunday)];
            }

            if (preset === "month") {
                const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                return [formatReportDate(firstDay), formatReportDate(lastDay)];
            }

            return [formatReportDate(today), formatReportDate(today)];
        }

        flatpickr("#startDate", { dateFormat: "Y-m-d", locale: { firstDayOfWeek: 1 } });
        flatpickr("#endDate", { dateFormat: "Y-m-d", locale: { firstDayOfWeek: 1 } });

        function syncPresetDates(force = false) {
            const preset = $('#reportPreset').val();
            const isCustom = preset === "custom";
            $('#startDate, #endDate').prop('readonly', !isCustom);

            if (!isCustom && force) {
                const [start, end] = getPresetRange(preset);
                $('#startDate').val(start);
                $('#endDate').val(end);
            }
        }

        $('#reportPreset').val(reportRange);
        syncPresetDates(false);

        $('#reportPreset').on('change', function() {
            syncPresetDates(true);
        });

        $('#applyDateFilter').on('click', function() {
            const preset = $('#reportPreset').val();
            const start = $('#startDate').val();
            const end = $('#endDate').val();

            if (!start || !end) {
                alert('Please select a valid start and end date.');
                return;
            }

            window.location.href = `main.php?id=report&range=${encodeURIComponent(preset)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        });

        $('#resetFilter').on('click', function() {
            const [start, end] = getPresetRange("today");
            window.location.href = `main.php?id=report&range=today&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        });
        // Modal Details Loader
        // Event delegation to support DataTable rows
        $(document).on("click", ".view-details", function() {
            let orderId = $(this).data("id");
            $("#modalContent").html("<p class='text-center'>Loading...</p>");
            $("#detailsModal").modal("show");

            $.get("/include/report/order_get", { id: orderId }, function(data) {
                $("#modalContent").html(data);
            });
        });

        $(document).on('click', '.cancel-order', function () {
            $('#cancel_order_id').val($(this).data('id'));
            $('#cancel_order_table').val($(this).data('table') || '');
            $('#cancel_order_reason').val('');
            $('#cancelOrderModal').modal('show');
        });

        $('#confirmCancelOrder').on('click', function () {
            const orderId = parseInt($('#cancel_order_id').val(), 10) || 0;
            const reason = $('#cancel_order_reason').val().trim();

            if (!orderId) {
                Swal.fire({ icon: 'error', title: 'Invalid Order', text: 'Order ID tidak ditemukan.' });
                return;
            }

            if (!reason) {
                Swal.fire({ icon: 'warning', title: 'Reason Required', text: 'Silakan isi alasan cancel order.' });
                return;
            }

            $.post('/include/report/order_cancel', { id: orderId, reason }, function (response) {
                if (response && response.status === 'success') {
                    $('#cancelOrderModal').modal('hide');
                    Swal.fire({ icon: 'success', title: 'Order Canceled', text: 'Status order berhasil diubah menjadi CANCEL.' })
                        .then(() => window.location.reload());
                } else {
                    Swal.fire({ icon: 'error', title: 'Cancel Failed', text: (response && response.message) || 'Unable to cancel order.' });
                }
            }, 'json').fail(function () {
                Swal.fire({ icon: 'error', title: 'Cancel Failed', text: 'Unable to cancel order.' });
            });
        });
    });
</script>
<script>
$(function () {
  if (!window.DejatiBluetoothPrinter) {
    console.error("Bluetooth printer manager is not loaded.");
  }

  function reportMoney(value) {
    return parseInt(value || 0, 10).toLocaleString("id-ID");
  }

  function requirePrinterManager() {
    if (!window.DejatiBluetoothPrinter) {
      throw new Error("Printer script is not loaded. Refresh the app once and try again.");
    }
    return window.DejatiBluetoothPrinter;
  }

  async function getReportPrinter(role, forceChooser = false) {
    const manager = requirePrinterManager();
    return forceChooser ? manager.setup(role) : manager.connect(role);
  }

  async function writeReportPrinter(role, escpos) {
    await requirePrinterManager().write(role, escpos);
  }

  async function writeReportPrintersSequentially(jobs) {
    await requirePrinterManager().writeSequential(jobs);
  }

  function waitForReportPrinter(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeReportItems(data) {
    const items = [];

    (data.items || []).forEach(item => {
      items.push({
        name: item.item_name || "-",
        qty: parseInt(item.quantity || 1, 10) || 1,
        unitPrice: parseInt(item.item_price || 0, 10) || 0,
        finalPrice: parseInt(item.item_price || 0, 10) || 0,
        notes: "",
        orderType: ""
      });
    });

    (data.carwash || []).forEach(item => {
      const notes = `NoPol: ${item.nopol || ""}, Service: ${item.service || ""}, Ukuran: ${item.ukuran || ""}, Vacuum: ${(item.vacuum || "no") === "yes" ? "Ya" : "Tidak"}`;
      items.push({
        name: item.item_name || "Carwash",
        qty: parseInt(item.qty || 1, 10) || 1,
        unitPrice: parseInt(item.unit_price || 0, 10) || 0,
        finalPrice: parseInt(item.unit_price || 0, 10) || 0,
        notes,
        orderType: "carwash"
      });
    });

    return items;
  }

  window.getReportPrinter = getReportPrinter;
  window.writeReportPrinter = writeReportPrinter;
  window.writeReportPrintersSequentially = writeReportPrintersSequentially;
  if (window.DejatiBluetoothPrinter) window.DejatiBluetoothPrinter.refreshStatus();

  function buildReportInvoice(data) {
    const order = data.order || {};
    const items = normalizeReportItems(data);
    const subtotal = items.reduce((sum, item) => sum + ((parseInt(item.finalPrice || item.unitPrice || 0, 10) || 0) * item.qty), 0);
    const grandTotal = parseInt(order.total_amount || subtotal, 10) || 0;
    const paid = parseInt(order.paid_amount || 0, 10) || 0;
    const change = parseInt(order.change_amount || 0, 10) || 0;
    const discount = Math.max(0, subtotal - grandTotal);
    const discountPercent = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;

    let escpos = "\x1B\x40\x1B\x61\x01";
    escpos += "Dejati Coffee Garden\nIG: instagram.com/dejati.coffee\nWifi: Dejati\nPassword: dejati37\n";
    escpos += "-----------------------------\n";
    escpos += `CASHIER DEJATI\nInvoice Reprint\nTable: ${order.table_number || "-"}\n-----------------------------\n`;

    items.forEach(item => {
      const price = parseInt(item.finalPrice || item.unitPrice || 0, 10) || 0;
      escpos += `${item.name} x${item.qty} Rp ${(price * item.qty).toLocaleString("id-ID")}\n`;
      if (item.notes) escpos += `  ${item.notes}\n`;
    });

    escpos += "-----------------------------\n";
    escpos += `Subtotal: Rp ${reportMoney(subtotal)}\n`;
    escpos += `Discount (${discountPercent}%): Rp ${reportMoney(discount)}\n`;
    escpos += `Total: Rp ${reportMoney(grandTotal)}\n`;
    escpos += `Bayar: Rp ${reportMoney(paid)}\n`;
    escpos += `Kembali: Rp ${reportMoney(change)}\n`;
    escpos += `Metode: ${order.payment_method || "-"}\n`;
    escpos += "-----------------------------\n";
    escpos += "Terima kasih atas kunjungannya!\n\n\n";
    escpos += "\x1D\x56\x00";
    return escpos;
  }

  function buildReportChit(title, data) {
    const order = data.order || {};
    const items = normalizeReportItems(data);
    let escpos = "\x1B\x40\x1B\x61\x01";
    escpos += "Dejati Coffee Garden\n";
    escpos += "-----------------------------\n";
    escpos += `${title}\nTable: ${order.table_number || "-"}\n-----------------------------\n`;

    items.forEach(item => {
      escpos += `${item.name} x${item.qty}\n`;
      if (item.orderType) escpos += `  Type: ${item.orderType}\n`;
      if (item.notes) escpos += `  Notes: ${item.notes}\n`;
    });

    escpos += "-----------------------------\n\n\n";
    escpos += "\x1D\x56\x00";
    return escpos;
  }

  function fetchReportOrder(orderId) {
    return $.get('/include/report/order_get_json.php', { id: orderId });
  }

  $(document).on('click', '.print-invoice', async function () {
    const orderId = $(this).data('id');
    try {
      await getReportPrinter('cashier');
      const data = await fetchReportOrder(orderId);
      await writeReportPrinter('cashier', buildReportInvoice(data));
      Swal.fire({ icon: 'success', title: 'Printed', text: 'Invoice sent to cashier printer.' });
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Print Invoice Failed', text: error.message || 'Unable to print invoice.' });
    }
  });

  $(document).on("click", ".print-chit", async function () {
    const orderId = $(this).data("id");
    try {
      const data = await fetchReportOrder(orderId);
      const cashierChit = buildReportChit("CASHIER CHIT REPRINT", data);
      const kitchenChit = buildReportChit("KITCHEN CHIT REPRINT", data);

      await writeReportPrinter("cashier", cashierChit);
      await waitForReportPrinter(1000);

      let kitchenError = null;
      try {
        await writeReportPrinter("kitchen", kitchenChit);
      } catch (error) {
        kitchenError = error;
      }

      if (kitchenError) {
        Swal.fire({
          icon: "warning",
          title: "Cashier Printed",
          text: "Chit sent to cashier. Kitchen printer failed: " + (kitchenError.message || "not connected.")
        });
      } else {
        Swal.fire({ icon: "success", title: "Printed", text: "Chit sent to cashier and kitchen printers." });
      }
    } catch (error) {
      Swal.fire({ icon: "error", title: "Print Chit Failed", text: error.message || "Unable to print chit." });
    }
  });
});
</script>
</body>

</html>
GET['start'] ?? '';
$endFilter =
