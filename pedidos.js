import { db, doc, getDoc, onSnapshot } from "./firebase.js";
import { escapeHtml, money, normalizePhone, whatsappLink } from "./utils.js";

const params = new URLSearchParams(location.search);
const estabelecimentoId = params.get("estabelecimento") || "";
const pedidoId = params.get("pedido") || "";
const code = sessionStorage.getItem("lastOrderCode");
const menuLink = document.querySelector("#order-menu-link");

if (menuLink && estabelecimentoId) {
  menuLink.href = `cardapio.html?estabelecimento=${estabelecimentoId}`;
}

if (code) {
  document.querySelector("#order-title").textContent = `Pedido ${code} registrado`;
}

if (!estabelecimentoId || !pedidoId) {
  document.querySelector("#order-summary").textContent = "Não foi possível localizar este pedido. Volte ao cardápio e acompanhe pelo WhatsApp cadastrado.";
} else {
  onSnapshot(doc(db, `estabelecimentos/${estabelecimentoId}/pedidos`, pedidoId), (snap) => {
    if (!snap.exists()) {
      document.querySelector("#order-summary").textContent = "Pedido não encontrado.";
      return;
    }
    renderOrder({ id: snap.id, ...snap.data() });
  }, (error) => {
    console.error("Não foi possível acompanhar pedido:", error);
    document.querySelector("#order-summary").textContent = "Não foi possível carregar o andamento agora.";
  });
}

function renderOrder(order) {
  const status = order.status || "Aguardando aprovação";
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
  updateStatusRequestLink(order);
}

async function updateStatusRequestLink(order) {
  const linkElement = document.querySelector("#order-whatsapp-link");
  if (!linkElement) return;
  try {
    const phone = await latestOrderWhatsApp();
    if (!phone) {
      linkElement.classList.add("hidden");
      return;
    }
    const trackingUrl = location.href;
    const message = [
      `Olá, gostaria de saber atualizações do meu pedido ${order.codigo || order.numeroPedido || order.id}.`,
      "",
      `Cliente: ${order.clienteNome || ""}`,
      `WhatsApp: ${order.whatsapp || ""}`,
      `Status atual: ${order.status || "Aguardando aprovação"}`,
      "",
      `Link do pedido: ${trackingUrl}`
    ].filter(Boolean).join("\n");
    linkElement.href = whatsappLink(phone, message);
    linkElement.classList.remove("hidden");
  } catch (error) {
    console.warn("Não foi possível montar link de atualização:", error);
    linkElement.classList.add("hidden");
  }
}

async function latestOrderWhatsApp() {
  const [settingsSnap, businessSnap] = await Promise.all([
    getDoc(doc(db, `estabelecimentos/${estabelecimentoId}/configuracoes`, "geral")),
    getDoc(doc(db, "estabelecimentos", estabelecimentoId))
  ]);
  const settings = settingsSnap.data() || {};
  const business = businessSnap.data() || {};
  return settings.whatsappPedidos || business.whatsapp || "";
}

function renderOrderStatusSteps(status = "") {
  const current = normalizeStatus(status);
  const steps = ["Aguardando aprovação", "Aceito", "Em preparo", "Pronto", "Saiu para entrega", "Entregue"];
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
