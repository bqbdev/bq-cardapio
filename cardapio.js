import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { calculatePaymentFee } from "./taxas.js";
import { getClientByWhatsApp, upsertClient } from "./clientes.js";
import { formToObject, money, normalizePhone, requireParam, setMessage, whatsappLink } from "./utils.js";

const state = {
  estabelecimentoId: requireParam("estabelecimento"),
  business: null,
  settings: {},
  fees: {},
  categories: [],
  products: [],
  cart: [],
  deliveryFee: 0,
  deliveryRule: ""
};
const $ = (selector) => document.querySelector(selector);
const businessDays = [
  ["domingo", "Domingo"],
  ["segunda", "Segunda"],
  ["terca", "Terca"],
  ["quarta", "Quarta"],
  ["quinta", "Quinta"],
  ["sexta", "Sexta"],
  ["sabado", "Sabado"]
];

init();

async function init() {
  if (!state.estabelecimentoId) {
    $("#menu-business-name").textContent = "Cardapio indisponivel";
    $("#menu-message").textContent = "Informe o estabelecimento no link do cardapio.";
    return;
  }
  await Promise.all([loadBusiness(), loadSettings(), loadFees(), loadCategories(), loadProducts()]);
  renderHeader();
  renderCategories();
  renderProducts();
  renderCart();
  renderDeliveryOptions();
}

async function loadBusiness() {
  const snap = await getDoc(doc(db, "estabelecimentos", state.estabelecimentoId));
  state.business = snap.data() || {};
}

async function loadSettings() {
  const snap = await getDoc(doc(db, `estabelecimentos/${state.estabelecimentoId}/configuracoes`, "geral"));
  state.settings = snap.data() || {};
}

async function loadFees() {
  const snap = await getDoc(doc(db, `estabelecimentos/${state.estabelecimentoId}/taxas`, "padrao"));
  state.fees = snap.data() || {};
}

async function loadCategories() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.estabelecimentoId}/categorias`), orderBy("ordem", "asc")));
  state.categories = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.ativo !== false);
}

async function loadProducts() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.estabelecimentoId}/produtos`), orderBy("nome", "asc")));
  state.products = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.disponivel !== false)
    .sort((a, b) => Number(Boolean(b.destaque)) - Number(Boolean(a.destaque)) || String(a.nome || "").localeCompare(String(b.nome || "")));
}

function renderHeader() {
  const name = state.settings.nomePublico || state.business.nomeEstabelecimento || "Cardapio";
  $("#menu-business-name").textContent = name;
  $("#menu-message").textContent = state.settings.mensagem || "Escolha seus itens e finalize pelo WhatsApp.";
  if (state.settings.logoUrl) {
    $("#menu-logo").innerHTML = `<img src="${state.settings.logoUrl}" alt="${name}">`;
  }
  renderOpeningHours();
}

function renderOpeningHours() {
  const target = $("#menu-hours");
  if (!target) return;
  const todayKey = businessDays[new Date().getDay()][0];
  const todayOpen = state.settings[`horario_${todayKey}_abre`];
  const todayClose = state.settings[`horario_${todayKey}_fecha`];
  const hasTodayHours = Boolean(todayOpen && todayClose);
  const openNow = hasTodayHours && isOpenNow(todayOpen, todayClose);
  const rows = businessDays.map(([key, label]) => {
    const open = state.settings[`horario_${key}_abre`];
    const close = state.settings[`horario_${key}_fecha`];
    return `<span>${label}: ${open && close ? `${open} as ${close}` : "Fechado"}</span>`;
  }).join("");
  target.innerHTML = `
    <strong class="${openNow ? "status-open" : "status-closed"}">${openNow ? "Aberto agora" : "Fechado agora"}</strong>
    <div class="hours-list">${rows}</div>
  `;
}

function isOpenNow(open, close) {
  const start = timeToMinutes(open);
  const end = timeToMinutes(close);
  if (start === null || end === null) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function timeToMinutes(value) {
  if (!value || !value.includes(":")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function renderCategories(activeId = "todos") {
  const tabs = [{ id: "todos", nome: "Todos" }, ...state.categories];
  $("#category-tabs").innerHTML = tabs.map((item) => `<button class="${item.id === activeId ? "active" : ""}" data-category="${item.id}">${item.nome}</button>`).join("");
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      renderCategories(button.dataset.category);
      renderProducts(button.dataset.category);
    });
  });
}

function renderProducts(categoryId = "todos") {
  const products = categoryId === "todos" ? state.products : state.products.filter((item) => item.categoriaId === categoryId);
  $("#menu-products").innerHTML = products.map((item) => `
    <article class="product-card">
      ${item.fotoUrl ? `<img src="${item.fotoUrl}" alt="${item.nome}">` : `<div class="product-image-fallback">BQ</div>`}
      <div class="product-body">
        <strong>${item.nome}</strong>
        ${item.destaque ? "<span class='pill'>Destaque</span>" : ""}
        <p>${item.descricao || ""}</p>
        <strong>${money(item.preco)}</strong>
        ${item.permiteObservacoes !== false ? `<input data-note="${item.id}" placeholder="Observacao do item">` : ""}
        <button class="btn btn-primary" data-add="${item.id}">Adicionar ao carrinho</button>
      </div>
    </article>
  `).join("") || "<p>Nenhum produto disponivel nesta categoria.</p>";
  document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  const note = document.querySelector(`[data-note="${productId}"]`)?.value || "";
  const existing = state.cart.find((item) => item.id === productId && item.observacao === note);
  if (existing) existing.quantidade += 1;
  else state.cart.push({ id: product.id, nome: product.nome, preco: Number(product.preco || 0), quantidade: 1, observacao: note, adicionais: [] });
  renderCart();
}

function renderCart() {
  $("#cart-items").innerHTML = state.cart.map((item, index) => `
    <div class="cart-line">
      <div><strong>${item.quantidade}x ${item.nome}</strong><small>${item.observacao || ""}</small></div>
      <div><strong>${money(item.preco * item.quantidade)}</strong><button class="btn btn-small" data-remove="${index}">Remover</button></div>
    </div>
  `).join("") || "<p>Seu carrinho esta vazio.</p>";
  $("#cart-total").textContent = money(cartSubtotal());
  document.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    state.cart.splice(Number(button.dataset.remove), 1);
    renderCart();
  }));
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.preco * item.quantidade, 0);
}

$("#checkout-open")?.addEventListener("click", () => {
  if (!state.cart.length) {
    alert("Adicione pelo menos um item ao carrinho.");
    return;
  }
  renderDeliveryOptions();
  $("#checkout-dialog").showModal();
});

$("#checkout-close")?.addEventListener("click", () => $("#checkout-dialog").close());

$("#payment-method")?.addEventListener("change", (event) => {
  $("#change-field").classList.toggle("hidden", event.target.value !== "Dinheiro");
});

$("#delivery-type")?.addEventListener("change", updateDeliveryPanel);
$("#checkout-form")?.elements.bairro?.addEventListener("input", updateDeliveryFee);

$("#lookup-client")?.addEventListener("click", async () => {
  const form = $("#checkout-form");
  const whatsapp = normalizePhone(form.elements.whatsapp.value);
  if (!whatsapp) return;
  const client = await getClientByWhatsApp(state.estabelecimentoId, whatsapp);
  if (!client) {
    setMessage($("#checkout-message"), "Cliente novo. Complete o cadastro para finalizar.");
    return;
  }
  ["nome", "cidade", "endereco", "numero", "complemento", "bairro", "referencia"].forEach((key) => {
    form.elements[key].value = client[key] || "";
  });
  updateDeliveryFee();
  setMessage($("#checkout-message"), "Cliente encontrado. Dados preenchidos automaticamente.");
});

$("#checkout-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const subtotal = cartSubtotal();
  if (data.tipoEntrega === "Entrega" && !updateDeliveryFee()) {
    setMessage($("#checkout-message"), "Confira o bairro para calcular a entrega antes de finalizar.", "error");
    return;
  }
  const paymentFee = calculatePaymentFee(subtotal, data.formaPagamento, state.fees);
  const deliveryFee = data.tipoEntrega === "Entrega" ? state.deliveryFee : 0;
  const totalFinal = subtotal + deliveryFee + (state.fees.somarAoPedido ? paymentFee : 0);
  const numeroPedido = generateOrderNumber();
  const codigo = `#${numeroPedido}`;
  const cleanPhone = await upsertClient(state.estabelecimentoId, data, totalFinal);
  const order = {
    estabelecimentoId: state.estabelecimentoId,
    clienteId: cleanPhone,
    clienteNome: data.nome,
    whatsapp: cleanPhone,
    itens: state.cart,
    observacoes: data.observacao || "",
    formaPagamento: data.formaPagamento,
    trocoPara: data.formaPagamento === "Dinheiro" ? data.trocoPara || "" : "",
    tipoEntrega: data.tipoEntrega,
    endereco: {
      endereco: data.endereco || "",
      numero: data.numero || "",
      complemento: data.complemento || "",
      bairro: data.bairro || "",
      cidade: data.cidade || "",
      referencia: data.referencia || ""
    },
    status: "Novo",
    subtotal,
    taxaConfigurada: paymentFee,
    taxaEntrega: deliveryFee,
    regraTaxaEntrega: state.deliveryRule,
    totalFinal,
    numeroPedido,
    codigo,
    criadoEm: serverTimestamp()
  };
  const ref = await addDoc(collection(db, `estabelecimentos/${state.estabelecimentoId}/pedidos`), order);
  const message = buildWhatsAppMessage({ ...order, id: ref.id });
  const phone = state.settings.whatsappPedidos || state.business.whatsapp;
  const link = whatsappLink(phone, message);
  sessionStorage.setItem("lastOrderLink", link);
  sessionStorage.setItem("lastOrderCode", codigo);
  location.href = `pedido.html?estabelecimento=${state.estabelecimentoId}&pedido=${ref.id}`;
});

function buildWhatsAppMessage(order) {
  const items = order.itens.map((item) => `- ${item.quantidade}x ${item.nome} (${money(item.preco * item.quantidade)})${item.observacao ? `\n  Obs: ${item.observacao}` : ""}`).join("\n");
  const address = order.tipoEntrega === "Entrega"
    ? `${order.endereco.endereco}, ${order.endereco.numero} - ${order.endereco.bairro}. ${order.endereco.referencia || ""}`
    : order.tipoEntrega;
  return [
    `Pedido ${order.codigo}`,
    `Cliente: ${order.clienteNome}`,
    `WhatsApp: ${order.whatsapp}`,
    `Entrega/retirada: ${address}`,
    "",
    "Itens:",
    items,
    "",
    `Pagamento: ${order.formaPagamento}`,
    order.trocoPara ? `Troco para: ${money(order.trocoPara)}` : "",
    order.observacoes ? `Observacoes: ${order.observacoes}` : "",
    `Subtotal: ${money(order.subtotal)}`,
    order.taxaEntrega ? `Taxa de entrega: ${money(order.taxaEntrega)}${order.regraTaxaEntrega ? ` - ${order.regraTaxaEntrega}` : ""}` : "",
    order.taxaConfigurada ? `Taxa de pagamento: ${money(order.taxaConfigurada)}` : "",
    `Total: ${money(order.totalFinal)}`
  ].filter(Boolean).join("\n");
}

function generateOrderNumber() {
  return Date.now().toString().slice(-6);
}

function renderDeliveryOptions() {
  const select = $("#delivery-type");
  if (!select) return;
  const options = [];
  if (state.settings.aceitaRetirada !== false) options.push(["Retirada", "Retirada"]);
  if (state.settings.aceitaEntrega === true) options.push(["Entrega", "Entrega"]);
  if (state.settings.aceitaLocal !== false) options.push(["Comer no local", "Comer no local"]);
  const enabledOptions = options.length ? options : [["Retirada", "Retirada"]];
  const current = select.value;
  select.innerHTML = enabledOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  if (enabledOptions.some(([value]) => value === current)) select.value = current;
  updateDeliveryPanel();
}

function updateDeliveryPanel() {
  const isDelivery = $("#delivery-type")?.value === "Entrega";
  $("#delivery-location-panel")?.classList.toggle("hidden", !isDelivery);
  if (!isDelivery) {
    state.deliveryFee = 0;
    state.deliveryRule = "";
    setMessage($("#delivery-fee-message"), "");
    return;
  }
  updateDeliveryFee();
}

function updateDeliveryFee() {
  if ($("#delivery-type")?.value !== "Entrega") return true;
  const form = $("#checkout-form");
  const bairro = form?.elements.bairro?.value || "";
  if (!bairro.trim()) {
    state.deliveryFee = 0;
    state.deliveryRule = "";
    setMessage($("#delivery-fee-message"), "Informe o bairro para calcular a entrega.", "error");
    return false;
  }
  const normalizedBairro = normalizeAreaName(bairro);
  const blockedAreas = parseBlockedAreas(state.settings.entregaBairrosBloqueados);
  if (blockedAreas.includes(normalizedBairro)) {
    state.deliveryFee = 0;
    state.deliveryRule = `Bairro nao atendido: ${bairro}`;
    setMessage($("#delivery-fee-message"), "Este bairro nao esta na area de entrega.", "error");
    return false;
  }
  const specialFees = parseAreaFees(state.settings.entregaBairrosTaxas);
  const hasSpecialFee = Object.prototype.hasOwnProperty.call(specialFees, normalizedBairro);
  const fee = hasSpecialFee ? specialFees[normalizedBairro] : configNumber(state.settings.entregaTaxaPadrao);
  state.deliveryFee = Math.max(0, fee);
  state.deliveryRule = hasSpecialFee ? `Taxa especial: ${bairro}` : "Taxa padrao";
  setMessage($("#delivery-fee-message"), `Taxa de entrega: ${money(state.deliveryFee)} (${state.deliveryRule}).`);
  return true;
}

function configNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAreaFees(text = "") {
  return String(text || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const [name, value] = line.split(/[=:;]/);
      const normalizedName = normalizeAreaName(name);
      if (normalizedName) acc[normalizedName] = configNumber(value);
      return acc;
    }, {});
}

function parseBlockedAreas(text = "") {
  return String(text || "").split(/[\n,;]/)
    .map((item) => normalizeAreaName(item))
    .filter(Boolean);
}

function normalizeAreaName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
