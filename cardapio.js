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
  clientCoords: null,
  deliveryDistanceKm: 0,
  deliveryFee: 0
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

$("#use-client-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setMessage($("#delivery-fee-message"), "Seu navegador nao permite pegar localizacao.", "error");
    return;
  }
  setMessage($("#delivery-fee-message"), "Buscando sua localizacao...");
  navigator.geolocation.getCurrentPosition((position) => {
    state.clientCoords = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
    updateDeliveryFee();
  }, () => {
    setMessage($("#delivery-fee-message"), "Nao foi possivel pegar a localizacao. Verifique a permissao do navegador.", "error");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

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
  setMessage($("#checkout-message"), "Cliente encontrado. Dados preenchidos automaticamente.");
});

$("#checkout-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const subtotal = cartSubtotal();
  if (data.tipoEntrega === "Entrega" && !updateDeliveryFee()) {
    setMessage($("#checkout-message"), "Para entrega, use sua localizacao para calcular a taxa antes de finalizar.", "error");
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
    distanciaEntregaKm: state.deliveryDistanceKm,
    clienteLocalizacao: state.clientCoords,
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
    order.taxaEntrega ? `Taxa de entrega: ${money(order.taxaEntrega)} (${Number(order.distanciaEntregaKm || 0).toFixed(1)} km)` : "",
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
    state.deliveryDistanceKm = 0;
    setMessage($("#delivery-fee-message"), "");
    return;
  }
  updateDeliveryFee();
}

function updateDeliveryFee() {
  if ($("#delivery-type")?.value !== "Entrega") return true;
  const origin = businessCoords();
  if (!origin) {
    setMessage($("#delivery-fee-message"), "O estabelecimento ainda precisa salvar a latitude e longitude nas configuracoes.", "error");
    return false;
  }
  if (!state.clientCoords) {
    setMessage($("#delivery-fee-message"), "Clique em usar minha localizacao para calcular a entrega.", "error");
    return false;
  }
  const distance = calculateDistanceKm(origin, state.clientCoords);
  const maxDistance = configNumber(state.settings.entregaRaioMaximoKm);
  if (maxDistance && distance > maxDistance) {
    setMessage($("#delivery-fee-message"), `Endereco fora do raio de entrega (${distance.toFixed(1)} km).`, "error");
    return false;
  }
  const base = configNumber(state.settings.entregaTaxaBase);
  const perKm = configNumber(state.settings.entregaValorKm);
  state.deliveryDistanceKm = distance;
  state.deliveryFee = Math.max(0, base + distance * perKm);
  setMessage($("#delivery-fee-message"), `Entrega calculada: ${money(state.deliveryFee)} para ${distance.toFixed(1)} km.`);
  return true;
}

function businessCoords() {
  const latitude = configNumber(state.settings.estabelecimentoLatitude || state.business.latitude, null);
  const longitude = configNumber(state.settings.estabelecimentoLongitude || state.business.longitude, null);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function configNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateDistanceKm(origin, destination) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return value * Math.PI / 180;
}
