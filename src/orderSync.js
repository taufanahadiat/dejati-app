export function sameOrderIdentity(order, ref) {
  if (!order || !ref) return false;
  const pairs = [
    [order.id, ref.id],
    [order.id, ref.clientOrderId],
    [order.clientOrderId, ref.id],
    [order.clientOrderId, ref.clientOrderId],
  ];
  if (pairs.some(([left, right]) => left && right && String(left) === String(right))) return true;
  if (order.serverOrderId && ref.serverOrderId)
    return String(order.serverOrderId) === String(ref.serverOrderId);
  return Boolean(ref.serverOrderId && order.id && String(order.id) === String(ref.serverOrderId));
}

export function syncableStatus(status) {
  return ["PAID", "OPEN BILL", "CANCEL"].includes(status);
}

export function reconcileLocalOrders(localOrders, serverOrders, statusOf) {
  if (!Array.isArray(serverOrders)) return { changed: false, settledIds: new Set() };
  let changed = false;
  const settledIds = new Set();
  for (const local of localOrders) {
    const server = serverOrders.find((row) => sameOrderIdentity(local, row));
    if (!server) continue;
    const serverStatus = statusOf(server);
    if (serverStatus !== "OPEN BILL") settledIds.add(String(local.id));
    const pendingOpenBillUpdate =
      local.synced === false &&
      statusOf(local) === "OPEN BILL" &&
      serverStatus === "OPEN BILL";
    if (pendingOpenBillUpdate) continue;
    const canonical = {
      ...server,
      id: local.id,
      clientOrderId: server.clientOrderId || local.id,
      serverOrderId: server.serverOrderId,
      synced: true,
    };
    if (JSON.stringify(local) !== JSON.stringify(canonical)) {
      Object.keys(local).forEach((key) => delete local[key]);
      Object.assign(local, canonical);
      changed = true;
    }
  }
  return { changed, settledIds };
}
