-- NULL preserves unknown historical data and uploads from older clients.
SET @present = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'order_type');
SET @ddl = IF(@present = 0,
    'ALTER TABLE order_items ADD COLUMN order_type ENUM(''dine-in'',''take-away'') NULL DEFAULT NULL AFTER item_name',
    'SELECT 1');
PREPARE order_type_migration FROM @ddl;
EXECUTE order_type_migration;
DEALLOCATE PREPARE order_type_migration;
