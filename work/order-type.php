<?php
function transactionOrderType($value): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_string($value)) throw new InvalidArgumentException('Jenis pesanan harus dine-in atau take-away.');
    $value = strtolower(str_replace(['_', ' '], '-', trim($value)));
    if (!in_array($value, ['dine-in', 'take-away'], true)) {
        throw new InvalidArgumentException('Jenis pesanan harus dine-in atau take-away.');
    }
    return $value;
}

function transactionItemOrderType(array $item): ?string
{
    $value = array_key_exists('orderType', $item) ? $item['orderType'] : ($item['order_type'] ?? null);
    return transactionOrderType($value);
}

function transactionOrderTypeLabel(?string $value): string
{
    return ['dine-in' => 'Dine In', 'take-away' => 'Take Away'][$value] ?? 'Belum tercatat';
}
