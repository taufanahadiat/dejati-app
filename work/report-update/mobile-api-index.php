<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Token');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

require_once __DIR__ . '/../../config/config.php';
date_default_timezone_set('Asia/Jakarta');

mysqli_query($conn, 'CREATE TABLE IF NOT EXISTS mobile_api_tokens (token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL)');
mysqli_query($conn, 'CREATE TABLE IF NOT EXISTS mobile_sync_orders (client_order_id CHAR(36) PRIMARY KEY, order_id INT NOT NULL, user_id INT NOT NULL, created_at DATETIME NOT NULL)');

function body(): array { $data = json_decode(file_get_contents('php://input'), true); return is_array($data) ? $data : []; }
function reply(array $data, int $status = 200): never { http_response_code($status); echo json_encode($data); exit; }
function bearer(): string {
  $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if ($header === '') $header = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
  return preg_match('/^Bearer\s+(.+)$/i', $header, $m) ? $m[1] : $header;
}
function user(mysqli $conn): array {
  $token = bearer(); if ($token === '') reply(['message' => 'Unauthorized'], 401);
  $hash = hash('sha256', $token); $stmt = mysqli_prepare($conn, 'SELECT u.id_user, u.username, u.nama_user, u.level FROM mobile_api_tokens t JOIN tb_user u ON u.id_user=t.user_id WHERE t.token_hash=? AND t.expires_at>NOW() AND LOWER(u.status)=\'aktif\' LIMIT 1');
  mysqli_stmt_bind_param($stmt, 's', $hash); mysqli_stmt_execute($stmt); $result = mysqli_stmt_get_result($stmt); $account = mysqli_fetch_assoc($result) ?: null;
  if (!$account) reply(['message' => 'Unauthorized'], 401); return $account;
}
function money(mixed $value): int { return max(0, (int) preg_replace('/[^0-9]/', '', (string) $value)); }

$path = trim((string) ($_GET['path'] ?? ''), '/');
if ($path === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $input = body(); $username = trim((string) ($input['username'] ?? '')); $password = (string) ($input['password'] ?? '');
  $stmt = mysqli_prepare($conn, 'SELECT id_user, username, nama_user, password, level, status FROM tb_user WHERE username=? LIMIT 1'); mysqli_stmt_bind_param($stmt, 's', $username); mysqli_stmt_execute($stmt); $account = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt)) ?: null;
  if (!$account || strtolower((string) $account['status']) !== 'aktif' || !password_verify($password, $account['password'])) reply(['message' => 'Username atau password salah'], 401);
  $token = bin2hex(random_bytes(32)); $hash = hash('sha256', $token); $expires = date('Y-m-d H:i:s', time() + 60 * 60 * 24 * 30);
  $stmt = mysqli_prepare($conn, 'INSERT INTO mobile_api_tokens (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,NOW())'); mysqli_stmt_bind_param($stmt, 'sis', $hash, $account['id_user'], $expires); mysqli_stmt_execute($stmt);
  reply(['token' => $token, 'user' => ['id' => $account['id_user'], 'name' => $account['nama_user'], 'role' => $account['level']]]);
}

$account = user($conn);
require_once __DIR__ . '/mobile-reports.php';
if ($path === 'catalog' && $_SERVER['REQUEST_METHOD'] === 'GET') {
  require_once __DIR__ . '/../../include/data/cafe/cafe_image_helper.php';
  $categories = [['id' => 'all', 'label' => 'All', 'icon' => 'grid_view'], ['id' => 'carwash', 'label' => 'Carwash', 'icon' => 'local_car_wash']];
  $q = mysqli_query($conn, 'SELECT id_cat, name_cat, icon FROM tb_category ORDER BY name_cat ASC');
  while ($row = mysqli_fetch_assoc($q)) $categories[] = ['id' => (string)$row['id_cat'], 'label' => $row['name_cat'], 'icon' => $row['icon'] ?: 'restaurant'];
  $items = []; $q = mysqli_query($conn, 'SELECT p.id_prod id, p.nama_prod name, p.biaya price, p.variant, p.nama_var, p.biaya_var, p.id_cat category, p.foto, c.name_cat category_name, c.icon category_icon FROM tb_datacafe p LEFT JOIN tb_category c ON c.id_cat=p.id_cat ORDER BY p.nama_prod');
  while ($row = mysqli_fetch_assoc($q)) $items[] = ['id' => (string)$row['id'], 'name' => $row['name'], 'price' => (int)$row['price'], 'variant' => (int)($row['variant'] ?? 0), 'nama_var' => $row['nama_var'] ?? '', 'biaya_var' => $row['biaya_var'] ?? '', 'category' => (string)$row['category'], 'categoryLabel' => $row['category_name'] ?: 'Cafe', 'categoryIcon' => $row['category_icon'] ?: 'restaurant', 'cartType' => 'product', 'image' => 'https://pos.dejaticoffee.com' . cafe_product_thumb_url($row['foto'] ?? '')];
  $q = mysqli_query($conn, 'SELECT id_produk id, produk name, biaya price FROM tb_datacarwash ORDER BY produk'); while ($row = mysqli_fetch_assoc($q)) $items[] = ['id' => (string)$row['id'], 'name' => $row['name'], 'price' => (int)$row['price'], 'category' => 'carwash', 'categoryLabel' => 'Carwash', 'categoryIcon' => 'local_car_wash', 'cartType' => 'carwash', 'image' => 'https://pos.dejaticoffee.com/dist/img/default-150x150.png'];
  reply(['products' => $items, 'categories' => $categories, 'synced_at' => date(DATE_ATOM)]);
}
if ($path === 'orders' && $_SERVER['REQUEST_METHOD'] === 'POST') {
  $input = body(); $clientId = (string)($input['client_order_id'] ?? ''); $items = $input['items'] ?? []; $table = trim((string)($input['table_number'] ?? '')); $method = strtolower((string)($input['payment_method'] ?? 'cash'));
  if (!preg_match('/^[a-f0-9-]{36}$/i', $clientId) || !$items || !$table || !in_array($method, ['cash','qris','credit_card'], true)) reply(['message' => 'Data transaksi tidak valid'], 422);
  $stmt = mysqli_prepare($conn, 'SELECT order_id FROM mobile_sync_orders WHERE client_order_id=?'); mysqli_stmt_bind_param($stmt, 's', $clientId); mysqli_stmt_execute($stmt); $exists = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt)); if ($exists) reply(['order_id' => (int)$exists['order_id'], 'duplicate' => true]);
  $total = 0; foreach ($items as $item) $total += money($item['unitPrice'] ?? 0) * max(1, (int)($item['qty'] ?? 1)); if ($total < 1) reply(['message' => 'Total transaksi tidak valid'], 422);
  mysqli_begin_transaction($conn); try {
    $status = 'PAID'; $paid = $total; $change = 0; $stmt = mysqli_prepare($conn, 'INSERT INTO orders (table_number,payment_method,total_amount,paid_amount,change_amount,status_order,created_at) VALUES (?,?,?,?,?,?,NOW())'); mysqli_stmt_bind_param($stmt, 'ssiiis', $table, $method, $total, $paid, $change, $status); mysqli_stmt_execute($stmt); $orderId = mysqli_insert_id($conn);
    foreach ($items as $item) { $id = (string)($item['id'] ?? ''); $name = (string)($item['name'] ?? ''); $qty = max(1, (int)($item['qty'] ?? 1)); $price = money($item['unitPrice'] ?? 0); if (($item['cartType'] ?? 'product') === 'carwash') { $stmt = mysqli_prepare($conn, 'INSERT INTO order_carwash (id_tr,id_prod,item_name,qty,unit_price,total,nopol,service,ukuran,vacuum,profit_pegawai,profit_management) VALUES (?,?,?,?,?,?,\'\',\'\',\'\',\'no\',?,?)'); $line = $price*$qty; $staff=(int)round($line*.3); $management=$line-$staff; mysqli_stmt_bind_param($stmt, 'issiiiii', $orderId,$id,$name,$qty,$price,$line,$staff,$management); } else { $stmt = mysqli_prepare($conn, 'INSERT INTO order_items (id_tr,id_prod,item_name,item_price,quantity,total) VALUES (?,?,?,?,?,?)'); $line=$price*$qty; mysqli_stmt_bind_param($stmt, 'issiii', $orderId,$id,$name,$price,$qty,$line); } mysqli_stmt_execute($stmt); }
    $stmt = mysqli_prepare($conn, 'INSERT INTO mobile_sync_orders (client_order_id,order_id,user_id,created_at) VALUES (?,?,?,NOW())'); mysqli_stmt_bind_param($stmt, 'sii', $clientId,$orderId,$account['id_user']); mysqli_stmt_execute($stmt); mysqli_commit($conn); reply(['order_id'=>$orderId,'total'=>$total]);
  } catch (Throwable $e) { mysqli_rollback($conn); reply(['message' => 'Gagal menyimpan transaksi'], 500); }
}
if ($path === 'daily-report' && $_SERVER['REQUEST_METHOD'] === 'GET') {
  $r = mysqli_query($conn, "SELECT COALESCE(SUM(total_amount),0) total_sales, COALESCE(SUM(CASE WHEN payment_method='cash' THEN total_amount END),0) cash, COALESCE(SUM(CASE WHEN payment_method='qris' THEN total_amount END),0) qris, COALESCE(SUM(CASE WHEN payment_method='credit_card' THEN total_amount END),0) card FROM orders WHERE DATE(created_at)=CURDATE()"); $row = mysqli_fetch_assoc($r); reply(['date'=>date('Y-m-d'),'total_sales'=>(int)$row['total_sales'],'cash'=>(int)$row['cash'],'qris'=>(int)$row['qris'],'card'=>(int)$row['card']]);
}
if ($path === 'report-history' && $_SERVER['REQUEST_METHOD'] === 'GET') {
  // One consistent snapshot, including server-created orders and upload identities.
  mysqli_begin_transaction($conn, MYSQLI_TRANS_START_READ_ONLY | MYSQLI_TRANS_START_WITH_CONSISTENT_SNAPSHOT);
  try {
    $orders = [];
    $r = mysqli_query($conn, 'SELECT o.id,o.table_number,o.payment_method,o.total_amount,o.paid_amount,o.created_at,m.client_order_id FROM orders o LEFT JOIN mobile_sync_orders m ON m.order_id=o.id ORDER BY o.created_at DESC,o.id DESC');
    while ($row = mysqli_fetch_assoc($r)) {
      $id = (int)$row['id'];
      $orders[$id] = ['id'=>'server-'.$id, 'serverOrderId'=>$id, 'clientOrderId'=>$row['client_order_id'], 'table'=>$row['table_number'], 'method'=>$row['payment_method'], 'total'=>(int)$row['total_amount'], 'paid'=>(int)$row['paid_amount'], 'createdAt'=>str_replace(' ', 'T', $row['created_at']).'+07:00', 'items'=>[], 'synced'=>true];
    }
    $r = mysqli_query($conn, "SELECT id_tr,id_prod,item_name,item_price price,quantity qty,total,'product' cart_type FROM order_items UNION ALL SELECT id_tr,id_prod,item_name,unit_price,qty,total,'carwash' FROM order_carwash");
    while ($row = mysqli_fetch_assoc($r)) {
      $id = (int)$row['id_tr'];
      if (isset($orders[$id])) $orders[$id]['items'][] = ['id'=>(string)$row['id_prod'], 'name'=>$row['item_name'], 'price'=>(int)$row['price'], 'qty'=>(int)$row['qty'], 'lineTotal'=>(int)$row['total'], 'cartType'=>$row['cart_type']];
    }
    $expenses = [];
    $r = mysqli_query($conn, 'SELECT DATE(created_at) date,COALESCE(SUM(total),0) total FROM pengeluaran GROUP BY DATE(created_at)');
    while ($row = mysqli_fetch_assoc($r)) $expenses[$row['date']] = (int)$row['total'];
    mysqli_commit($conn);
    reply(['orders'=>array_values($orders), 'expenses'=>$expenses, 'synced_at'=>date(DATE_ATOM)]);
  } catch (Throwable $e) {
    mysqli_rollback($conn);
    reply(['message'=>'Gagal mengambil report server'], 500);
  }
}

reply(['message' => 'Not found'], 404);
