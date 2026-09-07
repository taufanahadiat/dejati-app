<?php
require_once __DIR__ . '/../../config/session.php';
session_start();

if (empty($_SESSION['loggedin'])) {
  http_response_code(401);
  exit('Sesi login sudah berakhir. Silakan login kembali.');
}

require_once __DIR__ . '/../../config/config.php';
date_default_timezone_set('Asia/Jakarta');

function closingScalar(mysqli $conn, string $sql): int
{
  $result = mysqli_query($conn, $sql);
  if (!$result) {
    throw new RuntimeException(mysqli_error($conn));
  }

  $row = mysqli_fetch_assoc($result);
  return (int) ($row['total'] ?? 0);
}

$paidOrderCondition = "UPPER(COALESCE(NULLIF(o.status_order, ''), CASE WHEN o.paid_amount = 0 THEN 'OPEN BILL' ELSE 'PAID' END)) = 'PAID'";

try {
  $totalPenjualan = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(o.total_amount), 0) AS total FROM orders o
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition"
  );
  $cash = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(o.total_amount), 0) AS total FROM orders o
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition AND o.payment_method = 'cash'"
  );
  $qris = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(o.total_amount), 0) AS total FROM orders o
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition AND o.payment_method = 'qris'"
  );
  $card = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(o.total_amount), 0) AS total FROM orders o
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition AND o.payment_method = 'credit_card'"
  );
  $cafe = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(i.total), 0) AS total FROM order_items i
     INNER JOIN orders o ON o.id = i.id_tr
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition"
  );
  $carwash = closingScalar(
    $conn,
    "SELECT COALESCE(SUM(c.total), 0) AS total FROM order_carwash c
     INNER JOIN orders o ON o.id = c.id_tr
     WHERE DATE(o.created_at) = CURDATE() AND $paidOrderCondition"
  );

  $pengeluaranResult = mysqli_query(
    $conn,
    'SELECT keterangan, total, created_at FROM pengeluaran WHERE DATE(created_at) = CURDATE() ORDER BY id ASC'
  );
  if (!$pengeluaranResult) {
    throw new RuntimeException(mysqli_error($conn));
  }

  $pengeluaranRows = [];
  $totalPengeluaran = 0;
  while ($row = mysqli_fetch_assoc($pengeluaranResult)) {
    $pengeluaranRows[] = $row;
    $totalPengeluaran += (int) $row['total'];
  }
} catch (Throwable $e) {
  http_response_code(500);
  exit('Gagal menghitung closing harian.');
}

$isSaveRequest = $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['save'] ?? '') === '1';

if ($isSaveRequest) {
  $jsonPengeluaran = json_encode($pengeluaranRows, JSON_UNESCAPED_UNICODE);
  if ($jsonPengeluaran === false) {
    http_response_code(500);
    exit('Gagal menyiapkan data pengeluaran.');
  }

  mysqli_begin_transaction($conn);
  try {
    $existing = $conn->prepare('SELECT id FROM tb_closingan WHERE tanggal = CURDATE() ORDER BY id DESC LIMIT 1 FOR UPDATE');
    $existing->execute();
    $existingRow = $existing->get_result()->fetch_assoc();
    $existing->close();

    if ($existingRow) {
      $stmt = $conn->prepare(
        'UPDATE tb_closingan
         SET total_penjualan = ?, cash = ?, qris = ?, card = ?, cafe = ?, carwash = ?, detail_pengeluaran = ?, created_at = NOW()
         WHERE id = ?'
      );
      $closingId = (int) $existingRow['id'];
      $stmt->bind_param('iiiiiisi', $totalPenjualan, $cash, $qris, $card, $cafe, $carwash, $jsonPengeluaran, $closingId);
    } else {
      $stmt = $conn->prepare(
        'INSERT INTO tb_closingan
         (tanggal, total_penjualan, cash, qris, card, cafe, carwash, detail_pengeluaran, created_at)
         VALUES (CURDATE(), ?, ?, ?, ?, ?, ?, ?, NOW())'
      );
      $stmt->bind_param('iiiiiis', $totalPenjualan, $cash, $qris, $card, $cafe, $carwash, $jsonPengeluaran);
    }

    if (!$stmt->execute()) {
      throw new RuntimeException($stmt->error);
    }
    $stmt->close();
    mysqli_commit($conn);
  } catch (Throwable $e) {
    mysqli_rollback($conn);
    http_response_code(500);
    exit('Gagal menyimpan closing harian.');
  }

  header('Content-Type: text/plain; charset=UTF-8');
  $escpos = "\x1B\x40\x1B\x61\x01";
  $escpos .= "Dejati Coffee Garden\nLaporan Closing Harian\n-----------------------------\n";
  $escpos .= 'Tanggal: ' . date('d-m-Y H:i') . "\n";
  $escpos .= "-----------------------------\n";
  $escpos .= 'Total Penjualan : Rp ' . number_format($totalPenjualan, 0, ',', '.') . "\n";
  $escpos .= 'Cash            : Rp ' . number_format($cash, 0, ',', '.') . "\n";
  $escpos .= 'QRIS            : Rp ' . number_format($qris, 0, ',', '.') . "\n";
  $escpos .= 'Kartu Kredit    : Rp ' . number_format($card, 0, ',', '.') . "\n";
  $escpos .= "-----------------------------\nPendapatan [+]\n";
  $escpos .= 'Cafe     : Rp ' . number_format($cafe, 0, ',', '.') . "\n";
  $escpos .= 'Carwash  : Rp ' . number_format($carwash, 0, ',', '.') . "\n";
  $escpos .= "-----------------------------\nPengeluaran [-]\n";

  if ($pengeluaranRows) {
    foreach ($pengeluaranRows as $pengeluaran) {
      $escpos .= $pengeluaran['keterangan'] . ' : Rp ' . number_format((int) $pengeluaran['total'], 0, ',', '.') . "\n";
    }
  } else {
    $escpos .= "Tidak ada pengeluaran\n";
  }

  $escpos .= "-----------------------------\n";
  $escpos .= 'Saldo Bersih     : Rp ' . number_format($totalPenjualan - $totalPengeluaran, 0, ',', '.') . "\n";
  $escpos .= "Terima kasih!\n\n\n\x1D\x56\x00";
  echo $escpos;
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  exit('Method not allowed.');
}
?>
<div>
  <h6>Ringkasan Transaksi Lunas</h6>
  <p>Total Penjualan: Rp <?= number_format($totalPenjualan, 0, ',', '.') ?></p>
  <p>Cash: Rp <?= number_format($cash, 0, ',', '.') ?></p>
  <p>QRIS: Rp <?= number_format($qris, 0, ',', '.') ?></p>
  <p>Kartu Kredit: Rp <?= number_format($card, 0, ',', '.') ?></p>

  <h6>Pendapatan per Divisi</h6>
  <p>Cafe: Rp <?= number_format($cafe, 0, ',', '.') ?></p>
  <p>Carwash: Rp <?= number_format($carwash, 0, ',', '.') ?></p>

  <h6>Pengeluaran</h6>
  <?php if ($pengeluaranRows): ?>
    <ul>
      <?php foreach ($pengeluaranRows as $pengeluaran): ?>
        <li><?= htmlspecialchars($pengeluaran['keterangan'], ENT_QUOTES, 'UTF-8') ?> - Rp <?= number_format((int) $pengeluaran['total'], 0, ',', '.') ?></li>
      <?php endforeach; ?>
    </ul>
  <?php else: ?>
    <p><i>Belum ada pengeluaran hari ini.</i></p>
  <?php endif; ?>
  <hr>
  <p class="mb-0"><strong>Saldo Bersih: Rp <?= number_format($totalPenjualan - $totalPengeluaran, 0, ',', '.') ?></strong></p>
</div>
