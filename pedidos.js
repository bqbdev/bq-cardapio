import { db, doc, onSnapshot } from "./firebase.js";
import { escapeHtml, money, normalizePhone } from "./utils.js";

const params = new URLSearchParams(location.search);
const estabelecimentoId = params.get("estabelecimento") || "";
const pedidoId = params.get("pedido") || "";
const link = sessionStorage.getItem("lastOrderLink");
const code = sessionStorage.getItem("lastOrderCode");
const menuLink = document.querySelector("#order-menu-link");

if (menuLink && estabelecimentoId) {
  menuLink.href = `cardapio.html?estabelecimento=${estabelecimentoId}`;
}

if (code) {
  document.querySelector("#order-title").textContent = `Pedido ${code} registrado`;
}

if (link) {
  document.querySelector("#order-whatsapp-link").href = link;
} else {
  document.querySelector("#order-whatsapp-link").classList.add("hidden");
}

if (!estabelecimentoId || !pedidoId) {
  document.querySelector("#order-summary").textContent = "Nao foi possivel localizar este pedido. Volte ao cardapio e acompanhe pelo WhatsApp cadastrado.";
} else {
  onSnapshot(doc(db, `estabelecimentos/${estabelecimentoId}/pedidos`, pedidoId), (snap) => {
    if (!snap.exists()) {
      document.querySelector("#order-summary").textContent = "Pedido nao encontrado.";
      return;
    }
    renderOrder({ id: snap.id, ...snap.data() });
  }, (error) => {
    console.error("Nao foi possivel acompanhar pedido:", error);
    document.querySelector("#order-summary").textContent = "Nao foi possivel carregar o andamento agora.";
  });
}

function renderOrder(order) {
  const status = order.status || "Aguardando aprovacao";
  document.querySelector("#order-title").textContent = `Pedido ${escapeHtml(order.codigo || order.numeroPedido || order.id)}`;
  document.querySelector("#order-summary").innerHTML = `
    <strong>Status atual: ${escapeHtml(status)}</strong>
    ${renderOrderStatusSteps(status)}
    <div class="order-detail-box">
      <span>${escapeHtml(order.tipoEntrega || "")} - ${money(order.totalFinal)}</span>
      <span>WhatsApp: ${escapeHtml(order.whatsapp || "")}</span>
      <span>Pagamento: ${escapeHtml(order.formaPagamento || "")}</span>
      ${order.taxaEntrega ? `<span>Taxa de entrega: ${money(order.taxaEntrega)}</span>` : ""}
    </div>
    <div class="order-items-box">
      ${(order.itens || []).map((item) => `
        <div><strong>${item.quantidade || 1}x ${escapeHtml(item.nome || "")}</strong><small>${escapeHtml(item.observacao || "")}</small></div>
      `).join("")}
    </div>
  `;
  const phone = normalizePhone(order.whatsapp || "");
  if (phone) localStorage.setItem(`bqClientPhone:${estabelecimentoId}`, phone);
}

function renderOrderStatusSteps(status = "") {
  const current = normalizeStatus(status);
  const steps = ["Aguardando aprovacao", "Aceito", "Em preparo", "Pronto", "Saiu para entrega", "Entregue"];
  if (current === normalizeStatus("Cancelado")) {
    return `<div class="status-timeline is-canceled"><span class="active">Cancelado</span></div>`;
  }
  const activeIndex = Math.max(0, steps.findIndex((item) => normalizeStatus(item) === current));
  return `<div class="status-timeline">${steps.map((step, index) => `<span class="${index <= activeIndex ? "active" : ""}">${step}</span>`).join("")}</div>`;
}

function normalizeStatus(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
