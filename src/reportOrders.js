// Server rows remain separate from the device's upload queue.
export function mergeReportOrders(serverOrders, localOrders) {
  if (!Array.isArray(serverOrders)) return localOrders;
  const clientIds = new Set(serverOrders.map(order => order.clientOrderId).filter(Boolean));
  const serverIds = new Set(serverOrders.map(order => String(order.serverOrderId)));
  return [...serverOrders, ...localOrders.filter(order =>
    !clientIds.has(order.id) && !serverIds.has(String(order.serverOrderId))
  )].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
