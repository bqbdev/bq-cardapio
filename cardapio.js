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
  cart: []
};
const $ = (selector) => document.querySelector(selector);

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
  $("#checkout-dialog").showModal();
});

$("#checkout-close")?.addEventListener("click", () => $("#checkout-dialog").close());

$("#payment-method")?.addEventListener("change", (event) => {
  $("#change-field").classList.toggle("hidden", event.target.value !== "Dinheiro");
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
  const fee = calculatePaymentFee(subtotal, data.formaPagamento, state.fees);
  const totalFinal = subtotal + (state.fees.somarAoPedido ? fee : 0);
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
    taxaConfigurada: fee,
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
  const address = order.tipoEntrega === "Entrega propria do estabelecimento"
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
    order.taxaConfigurada ? `Taxa estimada: ${money(order.taxaConfigurada)}` : "",
    `Total: ${money(order.totalFinal)}`
  ].filter(Boolean).join("\n");
}

function generateOrderNumber() {
  return Date.now().toString().slice(-6);
}
