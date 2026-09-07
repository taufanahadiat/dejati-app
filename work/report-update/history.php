<?php
$breadcrumb = [
    ['label' => 'Riwayat Closing Harian', 'link' => '#'],
];

$selectedMonth = (string) ($_GET['month'] ?? '');
$selectedYear = (string) ($_GET['year'] ?? '');

if ($selectedMonth !== '' && !preg_match('/^(0[1-9]|1[0-2])$/', $selectedMonth)) {
    $selectedMonth = '';
}
if ($selectedYear !== '' && !preg_match('/^\d{4}$/', $selectedYear)) {
    $selectedYear = '';
}

$years = [];
$yearResult = mysqli_query($conn, 'SELECT DISTINCT YEAR(tanggal) AS year FROM tb_closingan ORDER BY year DESC');
if ($yearResult) {
    while ($yearRow = mysqli_fetch_assoc($yearResult)) {
        $years[] = (string) $yearRow['year'];
    }
}

$where = [];
$params = [];
$types = '';
if ($selectedMonth !== '') {
    $where[] = 'MONTH(c.tanggal) = ?';
    $params[] = (int) $selectedMonth;
    $types .= 'i';
}
if ($selectedYear !== '') {
    $where[] = 'YEAR(c.tanggal) = ?';
    $params[] = (int) $selectedYear;
    $types .= 'i';
}

$sql = 'SELECT c.*
        FROM tb_closingan c
        INNER JOIN (
            SELECT tanggal, MAX(id) AS latest_id
            FROM tb_closingan
            GROUP BY tanggal
        ) latest ON latest.latest_id = c.id';
if ($where) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY c.tanggal DESC';

$stmt = $conn->prepare($sql);
if ($params) {
    $stmt->bind_param($types, ...$params);
}
$stmt->execute();
$result = $stmt->get_result();

$records = [];
$summary = [
    'sales' => 0,
    'expenses' => 0,
    'net' => 0,
];

while ($row = $result->fetch_assoc()) {
    $detail = json_decode((string) ($row['detail_pengeluaran'] ?? ''), true);
    $detail = is_array($detail) ? $detail : [];
    $totalExpenses = 0;
    foreach ($detail as $expense) {
        $totalExpenses += (int) ($expense['total'] ?? 0);
    }

    $row['expense_detail'] = $detail;
    $row['total_expenses'] = $totalExpenses;
    $records[] = $row;
    $summary['sales'] += (int) $row['total_penjualan'];
    $summary['expenses'] += $totalExpenses;
}
$stmt->close();
$summary['net'] = $summary['sales'] - $summary['expenses'];

$months = [
    '01' => 'Januari', '02' => 'Februari', '03' => 'Maret', '04' => 'April',
    '05' => 'Mei', '06' => 'Juni', '07' => 'Juli', '08' => 'Agustus',
    '09' => 'September', '10' => 'Oktober', '11' => 'November', '12' => 'Desember',
];
?>

<section class="content">
  <div class="card card-outline card-dark">
    <div class="card-header">
      <div class="d-flex flex-wrap justify-content-between align-items-center">
        <div>
          <h4 class="mb-1">Riwayat Closing Harian</h4>
          <small class="text-muted">Satu rekap terbaru untuk setiap tanggal closing.</small>
        </div>
        <form method="GET" class="form-inline mt-2 mt-md-0">
          <input type="hidden" name="id" value="dailyReport">
          <select name="month" class="form-control form-control-sm mr-2" aria-label="Filter bulan">
            <option value="">Semua Bulan</option>
            <?php foreach ($months as $number => $name): ?>
              <option value="<?= $number ?>" <?= $selectedMonth === $number ? 'selected' : '' ?>>
                <?= $name ?>
              </option>
            <?php endforeach; ?>
          </select>
          <select name="year" class="form-control form-control-sm mr-2" aria-label="Filter tahun">
            <option value="">Semua Tahun</option>
            <?php foreach ($years as $year): ?>
              <option value="<?= htmlspecialchars($year, ENT_QUOTES, 'UTF-8') ?>" <?= $selectedYear === $year ? 'selected' : '' ?>>
                <?= htmlspecialchars($year, ENT_QUOTES, 'UTF-8') ?>
              </option>
            <?php endforeach; ?>
          </select>
          <button class="btn btn-primary btn-sm mr-2" type="submit"><i class="fas fa-filter"></i> Filter</button>
          <a href="main.php?id=dailyReport" class="btn btn-outline-secondary btn-sm">Reset</a>
        </form>
      </div>
    </div>

    <div class="card-body">
      <div class="row mb-3">
        <div class="col-md-4 mb-2 mb-md-0">
          <div class="small-box bg-info mb-0">
            <div class="inner"><h4>Rp <?= number_format($summary['sales'], 0, ',', '.') ?></h4><p>Total Penjualan</p></div>
          </div>
        </div>
        <div class="col-md-4 mb-2 mb-md-0">
          <div class="small-box bg-danger mb-0">
            <div class="inner"><h4>Rp <?= number_format($summary['expenses'], 0, ',', '.') ?></h4><p>Total Pengeluaran</p></div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="small-box bg-success mb-0">
            <div class="inner"><h4>Rp <?= number_format($summary['net'], 0, ',', '.') ?></h4><p>Saldo Bersih</p></div>
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-bordered table-striped table-hover">
          <thead class="thead-dark">
            <tr>
              <th>Tanggal</th>
              <th>Total Penjualan</th>
              <th>Cash</th>
              <th>QRIS</th>
              <th>Kartu</th>
              <th>Cafe</th>
              <th>Carwash</th>
              <th>Pengeluaran</th>
              <th>Saldo Bersih</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            <?php if (!$records): ?>
              <tr><td colspan="10" class="text-center text-muted py-4">Belum ada data closing untuk filter ini.</td></tr>
            <?php endif; ?>
            <?php foreach ($records as $row): ?>
              <?php $net = (int) $row['total_penjualan'] - (int) $row['total_expenses']; ?>
              <tr>
                <td><?= htmlspecialchars(date('d-m-Y', strtotime($row['tanggal'])), ENT_QUOTES, 'UTF-8') ?></td>
                <td>Rp <?= number_format((int) $row['total_penjualan'], 0, ',', '.') ?></td>
                <td>Rp <?= number_format((int) $row['cash'], 0, ',', '.') ?></td>
                <td>Rp <?= number_format((int) $row['qris'], 0, ',', '.') ?></td>
                <td>Rp <?= number_format((int) $row['card'], 0, ',', '.') ?></td>
                <td>Rp <?= number_format((int) $row['cafe'], 0, ',', '.') ?></td>
                <td>Rp <?= number_format((int) $row['carwash'], 0, ',', '.') ?></td>
                <td><span class="badge badge-danger">Rp <?= number_format((int) $row['total_expenses'], 0, ',', '.') ?></span></td>
                <td><strong>Rp <?= number_format($net, 0, ',', '.') ?></strong></td>
                <td>
                  <?php if ($row['expense_detail']): ?>
                    <button class="btn btn-sm btn-info" data-toggle="modal" data-target="#detailModal<?= (int) $row['id'] ?>">Lihat</button>
                  <?php else: ?>
                    <span class="text-muted">-</span>
                  <?php endif; ?>
                </td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</section>

<?php foreach ($records as $row): ?>
  <?php if ($row['expense_detail']): ?>
    <div class="modal fade" id="detailModal<?= (int) $row['id'] ?>" tabindex="-1" role="dialog" aria-hidden="true">
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Detail Pengeluaran (<?= htmlspecialchars(date('d-m-Y', strtotime($row['tanggal'])), ENT_QUOTES, 'UTF-8') ?>)</h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Tutup"><span aria-hidden="true">&times;</span></button>
          </div>
          <div class="modal-body table-responsive">
            <table class="table table-bordered mb-0">
              <thead><tr><th>Keterangan</th><th>Total</th><th>Waktu Input</th></tr></thead>
              <tbody>
                <?php foreach ($row['expense_detail'] as $expense): ?>
                  <tr>
                    <td><?= htmlspecialchars((string) ($expense['keterangan'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                    <td>Rp <?= number_format((int) ($expense['total'] ?? 0), 0, ',', '.') ?></td>
                    <td><?= htmlspecialchars((string) ($expense['created_at'] ?? '-'), ENT_QUOTES, 'UTF-8') ?></td>
                  </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
          <div class="modal-footer"><button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button></div>
        </div>
      </div>
    </div>
  <?php endif; ?>
<?php endforeach; ?>
