<?php
header('Content-Type: application/json; charset=UTF-8');

require_once __DIR__ . '/../../config/session.php';
session_start();

if (empty($_SESSION['loggedin'])) {
    http_response_code(401);
    echo json_encode(['status' => 'error', 'message' => 'Sesi login sudah berakhir.']);
    exit;
}

require_once __DIR__ . '/../../config/config.php';
date_default_timezone_set('Asia/Jakarta');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed.']);
    exit;
}

$data = json_decode((string) ($_POST['data'] ?? ''), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Data pengeluaran tidak valid.']);
    exit;
}

$expenses = [];
foreach ($data as $row) {
    $description = trim((string) ($row['keterangan'] ?? ''));
    $total = filter_var($row['total'] ?? null, FILTER_VALIDATE_INT);

    if ($description === '' || strlen($description) > 255 || $total === false || $total <= 0) {
        http_response_code(422);
        echo json_encode(['status' => 'error', 'message' => 'Keterangan dan nominal pengeluaran wajib diisi dengan benar.']);
        exit;
    }

    $expenses[] = [$description, (int) $total];
}

mysqli_begin_transaction($conn);
try {
    if ($expenses) {
        $stmt = $conn->prepare('INSERT INTO pengeluaran (keterangan, total, created_at) VALUES (?, ?, NOW())');
        foreach ($expenses as [$description, $total]) {
            $stmt->bind_param('si', $description, $total);
            if (!$stmt->execute()) {
                throw new RuntimeException($stmt->error);
            }
        }
        $stmt->close();
    }
    mysqli_commit($conn);
} catch (Throwable $e) {
    mysqli_rollback($conn);
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Gagal menyimpan pengeluaran.']);
    exit;
}

echo json_encode(['status' => 'success', 'count' => count($expenses)]);
