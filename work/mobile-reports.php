<?php
// Included after mobile token authentication; shared by the APK report routes.
declare(strict_types=1);

function reportQuery(mysqli $conn, string $sql, string $types = '', array $params = []): mysqli_stmt {
    $stmt = $conn->prepare($sql);
    if ($types !== '') $stmt->bind_param($types, ...$params);
    $stmt->execute();
    return $stmt;
}

function reportPaidSql(): string {
    return "UPPER(COALESCE(NULLIF(o.status_order, ''), CASE WHEN o.paid_amount = 0 THEN 'OPEN BILL' ELSE 'PAID' END)) = 'PAID'";
}

function reportClosing(mysqli $conn): array {
    $paid = reportPaidSql();
    $row = $conn->query("SELECT CURDATE() tanggal, COALESCE(SUM(o.total_amount),0) total_penjualan,
        COALESCE(SUM(IF(o.payment_method='cash',o.total_amount,0)),0) cash,
        COALESCE(SUM(IF(o.payment_method='qris',o.total_amount,0)),0) qris,
        COALESCE(SUM(IF(o.payment_method='credit_card',o.total_amount,0)),0) card
        FROM orders o WHERE DATE(o.created_at)=CURDATE() AND $paid")->fetch_assoc();
    foreach (['cafe'=>'order_items','carwash'=>'order_carwash'] as $key=>$table) {
        $row[$key] = (int)$conn->query("SELECT COALESCE(SUM(i.total),0) total FROM $table i JOIN orders o ON o.id=i.id_tr WHERE DATE(o.created_at)=CURDATE() AND $paid")->fetch_assoc()['total'];
    }
    $row['expenses'] = $conn->query('SELECT keterangan,total,created_at FROM pengeluaran WHERE DATE(created_at)=CURDATE() ORDER BY id')->fetch_all(MYSQLI_ASSOC);
    return reportNormalizeClosing($row);
}

function reportNormalizeClosing(array $row): array {
    foreach (['total_penjualan','cash','qris','card','cafe','carwash'] as $key) $row[$key] = (int)$row[$key];
    $row['expenses'] = $row['expenses'] ?? json_decode($row['detail_pengeluaran'] ?? '[]', true);
    if (!is_array($row['expenses'])) $row['expenses'] = [];
    $row['total_expenses'] = array_sum(array_map(fn($r)=>(int)($r['total'] ?? 0), $row['expenses']));
    $row['net'] = $row['total_penjualan'] - $row['total_expenses'];
    unset($row['detail_pengeluaran']);
    return $row;
}

function reportSnapshots(mysqli $conn): array {
    $result = $conn->query('SELECT * FROM tb_closingan ORDER BY tanggal DESC,id DESC');
    $rows = [];
    while ($row = $result->fetch_assoc()) {
        if (!isset($rows[$row['tanggal']])) $rows[$row['tanggal']] = reportNormalizeClosing($row);
    }
    return array_values($rows);
}

function reportHistory(mysqli $conn): array {
    $orders = [];
    $r = $conn->query("SELECT o.*,m.client_order_id FROM orders o LEFT JOIN mobile_sync_orders m ON m.order_id=o.id ORDER BY o.created_at DESC,o.id DESC");
    while ($row = $r->fetch_assoc()) {
        $id = (int)$row['id'];
        $orders[$id] = ['id'=>'server-'.$id,'serverOrderId'=>$id,'clientOrderId'=>$row['client_order_id'],
            'table'=>$row['table_number'],'method'=>$row['payment_method'],'total'=>(int)$row['total_amount'],
            'paid'=>(int)$row['paid_amount'],'change'=>(int)$row['change_amount'],
            'status'=>strtoupper($row['status_order'] ?: ((int)$row['paid_amount'] === 0 ? 'OPEN BILL' : 'PAID')),
            'cancelReason'=>$row['cancel_reason'],'canceledAt'=>$row['canceled_at'],
            'createdAt'=>str_replace(' ','T',$row['created_at']).'+07:00','items'=>[],'synced'=>true];
    }
    $r = $conn->query("SELECT id_tr,id_prod,item_name,item_price price,quantity qty,total,'product' cart_type,'' nopol,'' service,'' ukuran,'no' vacuum FROM order_items UNION ALL SELECT id_tr,id_prod,item_name,unit_price,qty,total,'carwash',nopol,service,ukuran,vacuum FROM order_carwash");
    while ($row = $r->fetch_assoc()) {
        $id = (int)$row['id_tr'];
        if (isset($orders[$id])) $orders[$id]['items'][] = ['id'=>(string)$row['id_prod'],'name'=>$row['item_name'],'price'=>(int)$row['price'],'qty'=>(int)$row['qty'],'lineTotal'=>(int)$row['total'],'cartType'=>$row['cart_type'],'nopol'=>$row['nopol'],'service'=>$row['service'],'ukuran'=>$row['ukuran'],'vacuum'=>$row['vacuum']];
    }
    foreach ($orders as &$order) {
        $order['subtotal'] = array_sum(array_column($order['items'],'lineTotal'));
        $order['discount'] = max(0, $order['subtotal']-$order['total']);
    }
    unset($order);
    $expenses = [];
    $r = $conn->query('SELECT DATE(created_at) date,COALESCE(SUM(total),0) total FROM pengeluaran GROUP BY DATE(created_at)');
    while ($row = $r->fetch_assoc()) $expenses[$row['date']] = (int)$row['total'];
    return ['orders'=>array_values($orders),'expenses'=>$expenses,'closings'=>reportSnapshots($conn),'synced_at'=>date(DATE_ATOM)];
}

function reportExpenseInput(array $input): array {
    if (!isset($input['expenses']) || !is_array($input['expenses']) || !array_is_list($input['expenses'])) throw new InvalidArgumentException('Data pengeluaran tidak valid.');
    $rows = [];
    foreach ($input['expenses'] as $row) {
        if (!is_array($row)) throw new InvalidArgumentException('Data pengeluaran tidak valid.');
        $description = trim((string)($row['keterangan'] ?? ''));
        $total = filter_var($row['total'] ?? null, FILTER_VALIDATE_INT);
        if ($description === '' || strlen($description)>255 || $total === false || $total<=0 || $total>2147483647) throw new InvalidArgumentException('Keterangan dan nominal pengeluaran wajib diisi dengan benar.');
        $rows[] = ['keterangan'=>$description,'total'=>$total];
    }
    return $rows;
}

function reportSaveClosing(mysqli $conn, array $input, int $userId): array {
    $expenses = reportExpenseInput($input);
    $key = (string)($input['request_id'] ?? '');
    if (!preg_match('/^[a-f0-9-]{36}$/i',$key)) throw new InvalidArgumentException('ID permintaan tidak valid.');
    $hash = hash('sha256',json_encode(['date'=>$input['date'] ?? '', 'expenses'=>$expenses]));
    // Lock also covers concurrent retries from another device connection.
    $lock = 'dejati-mobile-closing';
    if ((int)reportQuery($conn,'SELECT GET_LOCK(?,10) acquired','s',[$lock])->get_result()->fetch_assoc()['acquired'] !== 1) throw new RuntimeException('Closing sedang diproses. Coba kembali.');
    try {
        $conn->begin_transaction();
        $existing = reportQuery($conn,'SELECT user_id,payload_hash,response_json FROM mobile_report_requests WHERE request_id=?','s',[$key])->get_result()->fetch_assoc();
        if ($existing) {
            if ((int)$existing['user_id']!==$userId || !hash_equals($existing['payload_hash'],$hash)) throw new InvalidArgumentException('Permintaan closing berbeda dari percobaan sebelumnya.');
            $conn->commit();
            return json_decode($existing['response_json'],true,512,JSON_THROW_ON_ERROR);
        }
        if (($input['date'] ?? '')!==date('Y-m-d')) throw new InvalidArgumentException('Tanggal sudah berubah. Muat ulang preview closing hari ini.');
        foreach ($expenses as $row) reportQuery($conn,'INSERT INTO pengeluaran (keterangan,total,created_at) VALUES (?,?,NOW())','si',[$row['keterangan'],$row['total']]);
        $closing = reportClosing($conn);
        reportQuery($conn,'INSERT INTO tb_closingan (tanggal,total_penjualan,cash,qris,card,cafe,carwash,detail_pengeluaran,created_at) VALUES (?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE total_penjualan=VALUES(total_penjualan),cash=VALUES(cash),qris=VALUES(qris),card=VALUES(card),cafe=VALUES(cafe),carwash=VALUES(carwash),detail_pengeluaran=VALUES(detail_pengeluaran),created_at=NOW()',
            'siiiiiis',[$closing['tanggal'],$closing['total_penjualan'],$closing['cash'],$closing['qris'],$closing['card'],$closing['cafe'],$closing['carwash'],json_encode($closing['expenses'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
        $result = ['closing'=>$closing,'saved'=>true];
        reportQuery($conn,'INSERT INTO mobile_report_requests (request_id,user_id,payload_hash,response_json,created_at) VALUES (?,?,?,?,NOW())','siss',[$key,$userId,$hash,json_encode($result,JSON_THROW_ON_ERROR)]);
        $conn->commit();
        return $result;
    } catch (Throwable $e) { $conn->rollback(); throw $e; }
    finally { reportQuery($conn,'SELECT RELEASE_LOCK(?)','s',[$lock]); }
}

function reportOrderAction(mysqli $conn, string $action, array $input): array {
    $id = filter_var($input['id'] ?? null,FILTER_VALIDATE_INT);
    if (!$id || $id<1) throw new InvalidArgumentException('Order ID tidak valid.');
    $conn->begin_transaction();
    try {
        $order = reportQuery($conn,'SELECT * FROM orders WHERE id=? FOR UPDATE','i',[$id])->get_result()->fetch_assoc();
        if (!$order) throw new InvalidArgumentException('Transaksi tidak ditemukan.');
        $status = strtoupper($order['status_order'] ?: ((int)$order['paid_amount']===0?'OPEN BILL':'PAID'));
        if ($action==='order-cancel') {
            $reason = trim((string)($input['reason'] ?? ''));
            if ($reason==='' || strlen($reason)>5000) throw new InvalidArgumentException('Isi alasan pembatalan (maksimal 5000 byte).');
            if ($status!=='CANCEL') reportQuery($conn,"UPDATE orders SET status_order='CANCEL',cancel_reason=?,canceled_at=NOW() WHERE id=?",'si',[$reason,$id]);
        } else {
            $method = (string)($input['method'] ?? '');
            $paid = filter_var($input['paid'] ?? null,FILTER_VALIDATE_INT);
            if (!in_array($method,['cash','qris','credit_card'],true) || $paid===false || $paid<0 || $paid>2147483647) throw new InvalidArgumentException('Pembayaran tidak valid.');
            $total = (int)$order['total_amount'];
            if ($method!=='cash') $paid=$total;
            if ($paid<$total) throw new InvalidArgumentException('Uang bayar kurang.');
            if ($status==='CANCEL') throw new InvalidArgumentException('Transaksi sudah dibatalkan.');
            if ($status==='PAID' && ($order['payment_method']!==$method || (int)$order['paid_amount']!==$paid)) throw new InvalidArgumentException('Transaksi sudah dibayar dengan data berbeda. Muat ulang history.');
            if ($status==='OPEN BILL') reportQuery($conn,"UPDATE orders SET status_order='PAID',payment_method=?,paid_amount=?,change_amount=? WHERE id=?",'siii',[$method,$paid,$paid-$total,$id]);
        }
        $conn->commit();
        return ['success'=>true,'order_id'=>$id];
    } catch (Throwable $e) { $conn->rollback(); throw $e; }
}

if (defined('MOBILE_REPORTS_TEST')) return;
$reportRoutes = ['report-history'=>'GET','daily-reports'=>'GET','daily-report'=>'GET','closing-preview'=>'GET','closing-save'=>'POST','order-cancel'=>'POST','order-settle'=>'POST'];
if (isset($reportRoutes[$path])) {
    if ($_SERVER['REQUEST_METHOD']!==$reportRoutes[$path]) reply(['message'=>'Method not allowed'],405);
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    try {
        if ($path==='closing-save') reply(reportSaveClosing($conn,body(),(int)$account['id_user']));
        if ($path==='order-cancel' || $path==='order-settle') reply(reportOrderAction($conn,$path,body()));
        $conn->begin_transaction(MYSQLI_TRANS_START_READ_ONLY);
        if ($path==='report-history') $result=reportHistory($conn);
        elseif ($path==='daily-reports') $result=['records'=>reportSnapshots($conn)];
        else {
            $closing=reportClosing($conn);
            $result=$path==='closing-preview' ? ['closing'=>$closing] : ['date'=>$closing['tanggal'],'total_sales'=>$closing['total_penjualan'],'cash'=>$closing['cash'],'qris'=>$closing['qris'],'card'=>$closing['card']];
        }
        $conn->commit();
        reply($result);
    } catch (InvalidArgumentException $e) { $conn->rollback(); reply(['message'=>$e->getMessage()],422); }
    catch (Throwable $e) { $conn->rollback(); error_log('Mobile report: '.$e->getMessage()); reply(['message'=>'Gagal memproses laporan. Silakan coba kembali.'],500); }
}
