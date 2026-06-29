import { money } from "./utils.js";

export function renderFinanceSummary(selector, orders = []) {
  const target = document.querySelector(selector);
  if (!target) return;
  const validOrders = orders.filter((order) => order.status !== "Cancelado");
  const gross = validOrders.reduce((sum, order) => sum + Number(order.subtotal || order.totalFinal || 0), 0);
  const fees = validOrders.reduce((sum, order) => sum + Number(order.taxaConfigurada || 0), 0);
  const net = gross - fees;
  const average = validOrders.length ? gross / validOrders.length : 0;
  const cancelled = orders.filter((order) => order.status === "Cancelado").length;
  const byPayment = validOrders.reduce((acc, order) => {
    const key = order.formaPagamento || "Nao informado";
    acc[key] = (acc[key] || 0) + Number(order.totalFinal || 0);
    return acc;
  }, {});
  target.innerHTML = [
    ["Total vendido", money(gross)],
    ["Pedidos", validOrders.length],
    ["Ticket medio", money(average)],
    ["Taxas estimadas", money(fees)],
    ["Liquido estimado", money(net)],
    ["Cancelados", cancelled],
    ["PIX", money(byPayment.PIX || 0)],
    ["Credito", money(byPayment["Cartao de credito"] || 0)]
  ].map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
}
