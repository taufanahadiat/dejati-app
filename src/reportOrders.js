// Server rows remain separate from the device's upload queue.
export function mergeReportOrders(serverOrders, localOrders) {
  if (!Array.isArray(serverOrders)) return localOrders;
  const localClientIds = new Set(localOrders.map(order => order.id).filter(Boolean));
  const localServerIds = new Set(localOrders.map(order => order.serverOrderId).filter(Boolean).map(String));
  const server = serverOrders.filter(order =>
    !localClientIds.has(order.clientOrderId) && !localServerIds.has(String(order.serverOrderId))
  );
  const clientIds = new Set(serverOrders.map(order => order.clientOrderId).filter(Boolean));
  const serverIds = new Set(serverOrders.map(order => order.serverOrderId).filter(Boolean).map(String));
  return [...server, ...localOrders.filter(order =>
    !clientIds.has(order.id) && !serverIds.has(String(order.serverOrderId))
  ), ...localOrders.filter(order =>
    clientIds.has(order.id) || serverIds.has(String(order.serverOrderId))
  )].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
