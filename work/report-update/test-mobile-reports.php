<?php
declare(strict_types=1);
require '/var/www/html/config/config.php';
date_default_timezone_set('Asia/Jakarta');
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
define('MOBILE_REPORTS_TEST', true);
require '/tmp/dejati-mobile-reports.php';
function check(bool $condition,string $label): void { if (!$condition) throw new RuntimeException($label); echo "PASS $label\n"; }
// All writes target connection-local TEMPORARY tables. Production rows are never modified.
foreach (['orders','order_items','order_carwash','pengeluaran','tb_closingan','mobile_sync_orders'] as $table) {
    $ddl=$conn->query("SHOW CREATE TABLE $table")->fetch_assoc()['Create Table'];
    $conn->query(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$conn->query('CREATE TEMPORARY TABLE mobile_report_requests (request_id CHAR(36) PRIMARY KEY,user_id INT,payload_hash CHAR(64),response_json LONGTEXT,created_at DATETIME) ENGINE=InnoDB');
$conn->query("INSERT INTO orders (id,table_number,payment_method,total_amount,paid_amount,change_amount,status_order,created_at) VALUES (1,'TEST','cash',10000,10000,0,'PAID',NOW()),(2,'TEST','qris',20000,20000,0,'CANCEL',NOW()),(3,'TEST','cash',30000,0,0,'OPEN BILL',NOW())");
$conn->query("INSERT INTO order_items (id_tr,id_prod,item_name,item_price,quantity,total) VALUES (1,'test','Test Cafe',10000,1,10000),(2,'test','Canceled',20000,1,20000),(3,'test','Open',30000,1,30000)");
$preview=reportClosing($conn);
check($preview['total_penjualan']===10000 && $preview['cafe']===10000,'preview excludes CANCEL and OPEN BILL');
$history=reportHistory($conn);
check(count($history['orders'])===3 && count($history['closings'])===0,'history includes all statuses while closing history starts empty');
$request=['request_id'=>'11111111-1111-4111-8111-111111111111','date'=>date('Y-m-d'),'expenses'=>[['keterangan'=>'Test Expense','total'=>1000]]];
$saved=reportSaveClosing($conn,$request,1);
check($saved['closing']['net']===9000,'closing saves expense and net');
check(reportSaveClosing($conn,$request,1)===$saved,'retry returns original result');
check((int)$conn->query('SELECT COUNT(*) c FROM pengeluaran')->fetch_assoc()['c']===1,'retry does not duplicate expenses');
$request['request_id']='22222222-2222-4222-8222-222222222222';$request['expenses']=[];
reportSaveClosing($conn,$request,1);
check((int)$conn->query('SELECT COUNT(*) c FROM tb_closingan')->fetch_assoc()['c']===1,'second closing updates same date');
$bad=$request;$bad['request_id']='33333333-3333-4333-8333-333333333333';$bad['expenses']=[['keterangan'=>'valid','total'=>10],['keterangan'=>'invalid','total'=>-1]];
try { reportSaveClosing($conn,$bad,1); throw new RuntimeException('Expected validation error'); } catch(InvalidArgumentException $e) {}
check((int)$conn->query('SELECT COUNT(*) c FROM pengeluaran')->fetch_assoc()['c']===1,'invalid expense batch inserts nothing');
reportOrderAction($conn,'order-settle',['id'=>3,'method'=>'cash','paid'=>40000]);
check(reportClosing($conn)['total_penjualan']===40000,'settling open bill updates existing order revenue');
reportOrderAction($conn,'order-settle',['id'=>3,'method'=>'cash','paid'=>40000]);
check((int)$conn->query('SELECT COUNT(*) c FROM orders')->fetch_assoc()['c']===3,'payment retry creates no duplicate order');
reportOrderAction($conn,'order-cancel',['id'=>1,'reason'=>'Test cancellation']);
check(reportClosing($conn)['total_penjualan']===30000,'canceled paid order is removed from live totals');
check(reportSnapshots($conn)[0]['total_penjualan']===10000,'saved closing snapshot remains unchanged until next save');
echo "All report integration checks passed using temporary tables.\n";
