import {
  auth,
  db,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { addMonths, formToObject, money, numberValue, planMonths, printOrder, setMessage, todayStart, toBrazilDate } from "./utils.js";
import { renderFinanceSummary } from "./financeiro.js";
import { fillCoordinatesFromAddress } from "./geocoding.js";

const state = { businessId: "", business: null, categories: [], products: [], flavors: [], addons: [], orders: [], clients: [], orderSearch: "" };
const $ = (selector) => document.querySelector(selector);
let unsubscribeOrders = null;
const orderStatuses = ["Aguardando aprovação", "Aceito", "Em preparo", "Pronto", "Saiu para entrega", "Entregue", "Cancelado"];
const defaultSettings = {
  aceitaRetirada: true,
  aceitaEntrega: false,
  aceitaLocal: true
};

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      location.replace("login.html");
      return;
    }
    const businessDoc = await findBusinessForUser(user.uid);
    if (!businessDoc) {
      await signOut(auth);
      location.replace("login.html");
      return;
    }
    state.businessId = businessDoc.id;
    state.business = businessDoc.data();
    if (state.business.status !== "ativo") {
      alert("Acesso temporariamente bloqueado. Fale com a administração da plataforma.");
      await signOut(auth);
      location.replace("login.html");
      return;
    }
    sessionStorage.setItem("businessId", state.businessId);
    updateDoc(doc(db, "estabelecimentos", state.businessId), { ultimoAcesso: serverTimestamp() }).catch((error) => {
      console.warn("Não foi possível atualizar último acesso:", error);
    });
    renderBusinessHeader();
    await loadPanelData();
    document.body.classList.remove("protected-loading");
  } catch (error) {
    console.error("Falha ao verificar estabelecimento:", error);
    await signOut(auth);
    location.replace("login.html");
  }
});

$("#logout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  location.replace("login.html");
});
$("#refresh-orders")?.addEventListener("click", loadOrders);
$("#order-search")?.addEventListener("input", (event) => {
  state.orderSearch = event.target.value.trim().toLowerCase();
  renderOrders();
});
$("#product-photo-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const base64 = await imageFileToBase64(file, event.target, { maxDimension: 900, quality: 0.82 });
  if (!base64) return;
  const form = $("#product-form");
  form.elements.fotoUrl.value = base64;
  renderPhotoPreview(base64);
});
$("#business-logo-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const base64 = await imageFileToBase64(file, event.target, { maxDimension: 512, quality: 0.86 });
  if (!base64) return;
  const form = $("#settings-form");
  form.elements.logoUrl.value = base64;
  renderBusinessLogoPreview(base64);
  renderDashboardLogo(base64);
});
$("#use-business-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Seu navegador não permite pegar localização.");
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const form = $("#settings-form");
    form.elements.estabelecimentoLatitude.value = position.coords.latitude.toFixed(6);
    form.elements.estabelecimentoLongitude.value = position.coords.longitude.toFixed(6);
  }, () => {
    alert("Não foi possível pegar a localização. Verifique a permissão do navegador.");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

$("#geocode-business-address")?.addEventListener("click", async () => {
  try {
    await fillCoordinatesFromAddress($("#settings-form"));
    alert("Coordenadas preenchidas pelo endereço.");
  } catch (error) {
    alert(error.message);
  }
});
$("#add-delivery-fee-row")?.addEventListener("click", () => addDeliveryFeeRow());

$("#pizza-quick-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const categoriaId = doc(collection(db, "tmp")).id;
    const produtoId = doc(collection(db, "tmp")).id;
    const tamanhos = pizzaSizesFromQuickForm(data);
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/categorias`, categoriaId), {
      nome: data.categoriaNome || "Pizzas",
      descricao: "Categoria criada pelo módulo de pizzaria.",
      ordem: 0,
      ativo: true,
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, produtoId), {
      nome: data.produtoNome || "Pizza Meio a Meio",
      descricao: "Escolha o tamanho e os sabores da sua pizza.",
      categoriaId,
      preco: numberValue(data.precoBase),
      tipoProduto: "sabores",
      maxSabores: Math.max(1, Number(data.maxSabores || 2)),
      regraPreco: "maior_valor",
      pizzaMode: true,
      pizzaTamanhos: tamanhos,
      fotoUrl: "",
      disponivel: true,
      destaque: true,
      permiteObservacoes: true,
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    const existingPizzaFlavors = flavorsFromSizeCategories(data);
    const typedFlavors = parseBulkLines(data.sabores, 0);
    const flavorsToCreate = uniqueByName([...existingPizzaFlavors, ...typedFlavors]);
    if (!flavorsToCreate.length) {
      throw new Error("Escolha uma categoria com pizzas cadastradas ou digite pelo menos um sabor.");
    }
    await Promise.all(flavorsToCreate.map((item, index) => setDoc(doc(db, `estabelecimentos/${state.businessId}/sabores`, doc(collection(db, "tmp")).id), {
      nome: item.nome,
      preco: item.valor,
      precosPorTamanho: item.precosPorTamanho || {},
      categoriaId,
      ordem: index,
      disponivel: true,
      atualizadoEm: serverTimestamp()
    }, { merge: true })));
    await Promise.all(parseBulkLines(data.adicionais, 0).map((item) => setDoc(doc(db, `estabelecimentos/${state.businessId}/adicionais`, doc(collection(db, "tmp")).id), {
      nome: item.nome,
      preco: item.valor,
      aplicarEm: "produto",
      categoriaId: "",
      produtoId,
      disponivel: true,
      atualizadoEm: serverTimestamp()
    }, { merge: true })));
    form.reset();
    form.elements.categoriaNome.value = "Pizzas";
    form.elements.produtoNome.value = "Pizza Meio a Meio";
    form.elements.maxSabores.value = 2;
    if (form.elements.precoBase) form.elements.precoBase.value = 0;
    ["categoriaPequenaId", "categoriaMediaId", "categoriaGrandeId"].forEach((key) => {
      if (form.elements[key]) form.elements[key].value = "";
    });
    await loadCategories();
    await loadProducts();
    await Promise.all([loadFlavors(), loadAddons()]);
  }, "Módulo de pizza criado");
});

async function findBusinessForUser(uid) {
  const savedBusinessId = sessionStorage.getItem("businessId");
  if (savedBusinessId) {
    try {
      const savedSnap = await getDoc(doc(db, "estabelecimentos", savedBusinessId));
      if (savedSnap.exists() && savedSnap.data().uid === uid) {
        return { id: savedSnap.id, data: () => savedSnap.data() };
      }
    } catch (error) {
    console.warn("Não foi possível carregar estabelecimento salvo:", error);
    }
  }
  const snap = await getDocs(query(collection(db, "estabelecimentos"), where("uid", "==", uid)));
  if (snap.empty) return null;
  return snap.docs[0];
}

function renderBusinessHeader() {
  const name = state.business.nomeEstabelecimento || "Meu estabelecimento";
  $("#business-title").textContent = name;
  $("#business-name-short").textContent = name.split(" ")[0] || "Menu";
  $("#public-menu-link").href = `cardapio.html?estabelecimento=${state.businessId}`;
  renderDashboardLogo();
  renderRenewalInfo();
}

function renderDashboardLogo(src = "") {
  const target = $("#dashboard-logo");
  if (!target) return;
  const logo = src || $("#settings-form")?.elements.logoUrl?.value || "";
  target.innerHTML = logo ? `<img src="${logo}" alt="Logo do estabelecimento">` : "BQ";
  target.classList.toggle("has-image", Boolean(logo));
}

function renderRenewalInfo() {
  const plan = state.business.plano || "Essencial";
  const activationDate = state.business.dataAtivacao || state.business.dataInicio || new Date();
  const renewalDate = state.business.proximoVencimento || addMonths(activationDate, planMonths(plan));
  $("#next-renewal").textContent = toBrazilDate(renewalDate) || "--/--/----";
  $("#renewal-plan").textContent = `Plano ${plan}`;
}

async function loadPanelData() {
  await loadCategories();
  await loadProducts();
  await Promise.all([loadFlavors(), loadAddons(), loadOrders(), loadClients(), loadSettings(), loadFees()]);
}

async function loadCategories() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/categorias`), orderBy("ordem", "asc")));
  state.categories = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const categoryOptions = state.categories.map((item) => `<option value="${item.id}">${item.nome}</option>`).join("");
  $("#product-category").innerHTML = categoryOptions;
  $("#flavor-category").innerHTML = categoryOptions;
  ["#pizza-source-small", "#pizza-source-medium", "#pizza-source-large"].forEach((selector) => {
    if ($(selector)) $(selector).innerHTML = `<option value="">Não usar</option>${categoryOptions}`;
  });
  renderAddonCategoryChecks();
  $("#categories-list").innerHTML = state.categories.map((item) => `
    <div class="list-item">
      <strong>${item.nome}</strong><small>${item.ativo ? "Ativo" : "Inativo"} - ordem ${item.ordem || 0}</small>
      <button class="btn btn-small" data-edit-category="${item.id}" type="button">Editar</button>
    </div>
  `).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => fillCategory(button.dataset.editCategory)));
}

async function loadFlavors() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/sabores`), orderBy("nome", "asc")));
  state.flavors = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  $("#flavors-list").innerHTML = state.flavors.map((item) => `
    <div class="list-item compact-list-item">
      <strong>${item.nome}</strong>
      <small>${money(item.preco)} - ${categoryName(item.categoriaId)} - ${item.disponivel !== false ? "Disponível" : "Indisponível"}</small>
      <button class="btn btn-small" data-edit-flavor="${item.id}" type="button">Editar</button>
    </div>
  `).join("") || "<p>Nenhum sabor cadastrado.</p>";
  document.querySelectorAll("[data-edit-flavor]").forEach((button) => button.addEventListener("click", () => fillFlavor(button.dataset.editFlavor)));
}

async function loadAddons() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/adicionais`), orderBy("nome", "asc")));
  state.addons = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  $("#addons-list").innerHTML = state.addons.map((item) => `
    <div class="list-item compact-list-item">
      <strong>${item.nome}</strong>
      <small>${money(item.preco)} - ${addonScopeLabel(item)} - ${item.disponivel !== false ? "Disponível" : "Indisponível"}</small>
      <button class="btn btn-small" data-edit-addon="${item.id}" type="button">Editar</button>
    </div>
  `).join("") || "<p>Nenhum adicional cadastrado.</p>";
  document.querySelectorAll("[data-edit-addon]").forEach((button) => button.addEventListener("click", () => fillAddon(button.dataset.editAddon)));
}

async function loadProducts() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/produtos`), orderBy("nome", "asc")));
  state.products = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(Boolean(b.destaque)) - Number(Boolean(a.destaque)) || String(a.nome || "").localeCompare(String(b.nome || "")));
  $("#addon-product").innerHTML = `<option value="">Selecione se aplicar por produto</option>${state.products.map((item) => `<option value="${item.id}">${item.nome}</option>`).join("")}`;
  $("#products-list").innerHTML = state.products.map((item) => `
    <div class="list-item product-list-item ${item.disponivel === false ? "is-disabled" : ""}">
      <div class="product-admin-thumb">
        ${item.fotoUrl ? `<img src="${item.fotoUrl}" alt="${item.nome}">` : "<span>Sem foto</span>"}
      </div>
      <div class="product-admin-info">
        <strong>${item.nome} ${item.destaque ? "<span class='pill'>Destaque</span>" : ""}</strong>
        <small>${money(item.preco)} - ${item.disponivel !== false ? "Disponível" : "Indisponível"}</small>
        <small>${productTypeLabel(item)}${item.tipoProduto === "sabores" ? ` - até ${item.maxSabores || 1} sabor(es)` : ""}</small>
      </div>
      <div class="item-actions">
        <button class="btn btn-small" data-edit-product="${item.id}" type="button">Editar</button>
        <button class="btn btn-small ${item.disponivel !== false ? "btn-primary" : ""}" data-toggle-product="${item.id}" type="button">${item.disponivel !== false ? "Disponível" : "Ativar"}</button>
        <button class="btn btn-small btn-primary" data-highlight-product="${item.id}" type="button">${item.destaque ? "Remover destaque" : "Destacar"}</button>
        <button class="btn btn-small" data-change-photo="${item.id}" type="button">${item.fotoUrl ? "Trocar foto" : "Adicionar foto"}</button>
        <input class="hidden" data-photo-input="${item.id}" type="file" accept="image/*">
      </div>
    </div>
  `).join("") || "<p>Nenhum produto cadastrado.</p>";
  document.querySelectorAll("[data-edit-product]").forEach((button) => button.addEventListener("click", () => fillProduct(button.dataset.editProduct)));
  document.querySelectorAll("[data-toggle-product]").forEach((button) => button.addEventListener("click", () => toggleProductAvailability(button.dataset.toggleProduct)));
  document.querySelectorAll("[data-highlight-product]").forEach((button) => button.addEventListener("click", () => toggleProductHighlight(button.dataset.highlightProduct)));
  document.querySelectorAll("[data-change-photo]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`[data-photo-input="${button.dataset.changePhoto}"]`)?.click());
  });
  document.querySelectorAll("[data-photo-input]").forEach((input) => {
    input.addEventListener("change", () => updateProductPhoto(input.dataset.photoInput, input.files?.[0], input));
  });
}

function productTypeLabel(product) {
  if (product.pizzaMode) return "Pizza montável";
  if (product.tipoProduto === "sabores") return "Produto com sabores";
  return "Produto simples";
}

function categoryName(id) {
  return state.categories.find((item) => item.id === id)?.nome || "Sem categoria";
}

function addonScopeLabel(addon) {
  if (addon.aplicarEm === "categoria") {
    const ids = addonCategoryIds(addon);
    return `Categorias: ${ids.map(categoryName).join(", ") || "nenhuma"}`;
  }
  if (addon.aplicarEm === "produto") return `Produto: ${state.products.find((item) => item.id === addon.produtoId)?.nome || "não encontrado"}`;
  return "Todos os produtos";
}

function addonCategoryIds(addon) {
  if (Array.isArray(addon.categoriaIds)) return addon.categoriaIds.filter(Boolean);
  return addon.categoriaId ? [addon.categoriaId] : [];
}

function renderAddonCategoryChecks(selected = []) {
  const target = $("#addon-category-checks");
  if (!target) return;
  const selectedSet = new Set(selected);
  target.innerHTML = state.categories.map((category) => `
    <label class="category-check ${selectedSet.has(category.id) ? "is-selected" : ""}">
      <input type="checkbox" data-addon-category-id="${category.id}" ${selectedSet.has(category.id) ? "checked" : ""}>
      <span>${category.nome}</span>
    </label>
  `).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  target.querySelectorAll("[data-addon-category-id]").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest(".category-check")?.classList.toggle("is-selected", input.checked);
    });
  });
}

function selectedAddonCategoryIds() {
  return Array.from(document.querySelectorAll("[data-addon-category-id]:checked")).map((input) => input.dataset.addonCategoryId);
}

function setAddonCategorySelection(values = []) {
  renderAddonCategoryChecks(values);
}

function parseBulkLines(text = "", defaultValue = 0) {
  return String(text || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, value] = line.split(/[=:;]/);
      return {
        nome: name?.trim() || "",
        valor: value === undefined ? defaultValue : numberValue(value)
      };
    })
    .filter((item) => item.nome);
}

function flavorsFromSizeCategories(data = {}) {
  const sources = [
    { nome: "Pequena", categoriaId: data.categoriaPequenaId },
    { nome: "Média", categoriaId: data.categoriaMediaId },
    { nome: "Grande", categoriaId: data.categoriaGrandeId }
  ].filter((item) => item.categoriaId);
  const map = new Map();
  sources.forEach((source) => {
    state.products
      .filter((product) => product.categoriaId === source.categoriaId && product.disponivel !== false)
      .forEach((product) => {
        const key = normalizeName(product.nome);
        if (!key) return;
        const current = map.get(key) || { nome: product.nome, valor: numberValue(product.preco), precosPorTamanho: {} };
        current.precosPorTamanho[source.nome] = numberValue(product.preco);
        const validPrices = Object.values(current.precosPorTamanho).filter((value) => value > 0);
        current.valor = validPrices.length ? Math.min(...validPrices) : 0;
        map.set(key, current);
      });
  });
  return Array.from(map.values());
}

function uniqueByName(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeName(item.nome);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function pizzaSizesFromQuickForm(data) {
  const sizes = [
    { nome: "Pequena", preco: numberValue(data.precoBase), categoriaOrigemId: data.categoriaPequenaId || "" },
    { nome: "Média", preco: numberValue(data.precoBase), categoriaOrigemId: data.categoriaMediaId || "" },
    { nome: "Grande", preco: numberValue(data.precoBase), categoriaOrigemId: data.categoriaGrandeId || "" }
  ].filter((item) => item.categoriaOrigemId);
  return sizes.length ? sizes : [{ nome: "Grande", preco: numberValue(data.precoBase), categoriaOrigemId: "" }];
}

function parsePizzaSizes(text = "") {
  return parseBulkLines(text, 0)
    .map((item) => ({ nome: item.nome, preco: item.valor }))
    .filter((item) => item.nome);
}

function pizzaSizesToText(sizes = []) {
  return Array.isArray(sizes) ? sizes.map((item) => `${item.nome || ""}=${item.preco || 0}`).join("\n") : "";
}

function loadOrders() {
  if (unsubscribeOrders) unsubscribeOrders();
  return new Promise((resolve, reject) => {
    unsubscribeOrders = onSnapshot(query(collection(db, `estabelecimentos/${state.businessId}/pedidos`), orderBy("criadoEm", "desc")), (snap) => {
      state.orders = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderOrders();
      renderDashboard();
      renderFinanceSummary("#finance-summary", state.orders);
      resolve();
    }, reject);
  });
}

async function loadClients() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/clientes`), orderBy("ultimaCompra", "desc")));
  state.clients = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  $("#clients-list").innerHTML = state.clients.slice(0, 12).map((item) => `
    <article class="list-item">
      <strong>${item.nome || item.id}</strong>
      <span>${item.whatsapp || item.id}</span>
      <small>${clientAddress(item)}</small>
      <small>${item.totalCompras || 0} compras - ${money(item.valorTotalComprado)}</small>
    </article>
  `).join("") || "<p>Nenhum cliente ainda.</p>";
}

function clientAddress(client) {
  const address = [client.endereco, client.numero, client.bairro, client.cidade].filter(Boolean).join(", ");
  return address || "Endereço ainda não informado";
}

function renderOrders() {
  const orders = filteredOrders();
  $("#orders-list").innerHTML = orders.map((order) => `
    <article class="list-item">
      <strong>Pedido ${order.numeroPedido || order.codigo || order.id} - ${order.clienteNome || ""}</strong>
      <span>${order.status || "Novo"} - ${order.tipoEntrega || ""} - ${money(order.totalFinal)}</span>
      ${order.taxaEntrega ? `<small>Entrega: ${money(order.taxaEntrega)}${order.regraTaxaEntrega ? ` - ${order.regraTaxaEntrega}` : ""}</small>` : ""}
      <small>Codigo: ${order.codigo || order.id} - WhatsApp: ${order.whatsapp || ""}</small>
      <small>${(order.itens || []).map(orderItemSummary).join(", ")}</small>
      ${renderOrderStatusSteps(order.status)}
      <div class="item-actions">
        ${orderStatuses.map((status) => `<button class="btn btn-small ${normalizeStatus(order.status) === normalizeStatus(status) ? "btn-primary" : ""}" data-order-status="${order.id}" data-status-value="${status}" type="button">${status}</button>`).join("")}
        <button class="btn btn-small" data-print-client="${order.id}" type="button">Imprimir cliente</button>
        <button class="btn btn-small" data-print-kitchen="${order.id}" type="button">Imprimir cozinha</button>
        <button class="btn btn-small" data-print-delivery="${order.id}" type="button">Imprimir motoboy</button>
      </div>
    </article>
  `).join("") || "<p>Nenhum pedido encontrado.</p>";
  document.querySelectorAll("[data-order-status]").forEach((button) => button.addEventListener("click", () => updateOrderStatus(button.dataset.orderStatus, button.dataset.statusValue)));
  document.querySelectorAll("[data-print-client]").forEach((button) => button.addEventListener("click", () => printById(button.dataset.printClient, false)));
  document.querySelectorAll("[data-print-kitchen]").forEach((button) => button.addEventListener("click", () => printById(button.dataset.printKitchen, true)));
  document.querySelectorAll("[data-print-delivery]").forEach((button) => button.addEventListener("click", () => printById(button.dataset.printDelivery, "motoboy")));
}

function renderOrderStatusSteps(status = "") {
  const current = normalizeStatus(status || "Aguardando aprovação");
  if (current === normalizeStatus("Cancelado")) {
    return `<div class="status-timeline is-canceled"><span class="active">Cancelado</span></div>`;
  }
  const steps = orderStatuses.filter((statusName) => statusName !== "Cancelado");
  const activeIndex = Math.max(0, steps.findIndex((item) => normalizeStatus(item) === current));
  return `<div class="status-timeline">${steps.map((step, index) => `<span class="${index <= activeIndex ? "active" : ""}">${step}</span>`).join("")}</div>`;
}

function orderItemSummary(item) {
  const details = [
    item.tamanho ? `tamanho: ${item.tamanho.nome}` : "",
    item.sabores?.length ? `sabores: ${item.sabores.map((flavor) => flavor.nome).join("/")}` : "",
    item.adicionais?.length ? `adicionais: ${item.adicionais.map((addon) => addon.nome).join("/")}` : "",
    item.observacao ? `obs: ${item.observacao}` : ""
  ].filter(Boolean).join(" - ");
  return `${item.quantidade || 1}x ${item.nome}${details ? ` (${details})` : ""}`;
}

function normalizeStatus(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filteredOrders() {
  if (!state.orderSearch) return state.orders;
  return state.orders.filter((order) => [
    order.numeroPedido,
    order.codigo,
    order.id,
    order.clienteNome,
    order.whatsapp,
    order.status,
    order.formaPagamento,
    order.tipoEntrega
  ].some((value) => String(value || "").toLowerCase().includes(state.orderSearch)));
}

function renderDashboard() {
  const today = todayStart().toMillis();
  const todayOrders = state.orders.filter((order) => order.criadoEm?.toMillis?.() >= today);
  const total = todayOrders.reduce((sum, order) => sum + Number(order.totalFinal || 0), 0);
  const open = state.orders.filter((order) => !["Entregue", "Cancelado"].includes(order.status)).length;
  $("#orders-today").textContent = todayOrders.length;
  $("#sales-today").textContent = money(total);
  $("#orders-open").textContent = open;
  $("#average-ticket").textContent = money(todayOrders.length ? total / todayOrders.length : 0);
}

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, `estabelecimentos/${state.businessId}/pedidos`, id), { status });
}

function printById(id, mode) {
  const order = state.orders.find((item) => item.id === id);
  if (order) printOrder(order, mode);
}

$("#category-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/categorias`, id), {
      nome: data.nome,
      descricao: data.descricao || "",
      ordem: Number(data.ordem || 0),
      ativo: Boolean(data.ativo),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetCategoryForm(form);
    await loadCategories();
    await Promise.all([loadFlavors(), loadProducts(), loadAddons()]);
  });
});

$("#flavor-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/sabores`, id), {
      nome: data.nome,
      preco: numberValue(data.preco),
      categoriaId: data.categoriaId || "",
      ordem: Number(data.ordem || 0),
      disponivel: Boolean(data.disponivel),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetFlavorForm(form);
    await loadFlavors();
  });
});

$("#addon-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    const categoriaIds = selectedAddonCategoryIds();
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/adicionais`, id), {
      nome: data.nome,
      preco: numberValue(data.preco),
      aplicarEm: data.aplicarEm || "todos",
      categoriaId: data.aplicarEm === "categoria" ? categoriaIds[0] || "" : "",
      categoriaIds: data.aplicarEm === "categoria" ? categoriaIds : [],
      produtoId: data.aplicarEm === "produto" ? data.produtoId || "" : "",
      disponivel: Boolean(data.disponivel),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetAddonForm(form);
    await loadAddons();
  });
});

$("#product-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
      nome: data.nome,
      descricao: data.descricao || "",
      categoriaId: data.categoriaId || "",
      preco: numberValue(data.preco),
      tipoProduto: data.tipoProduto || "simples",
      maxSabores: Math.max(1, Number(data.maxSabores || 1)),
      regraPreco: data.regraPreco || "fixo",
      pizzaMode: Boolean(data.pizzaMode),
      pizzaTamanhos: parsePizzaSizes(data.pizzaTamanhosTexto),
      fotoUrl: data.fotoUrl || "",
      disponivel: Boolean(data.disponivel),
      destaque: Boolean(data.destaque),
      permiteObservacoes: Boolean(data.permiteObservacoes),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetProductForm(form);
    await loadProducts();
    await loadAddons();
  });
});

function resetCategoryForm(form = $("#category-form")) {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.ordem) form.elements.ordem.value = 0;
  if (form?.elements.ativo) form.elements.ativo.checked = true;
}

function resetFlavorForm(form = $("#flavor-form")) {
  const currentCategory = form?.elements.categoriaId?.value || "";
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.categoriaId && currentCategory) form.elements.categoriaId.value = currentCategory;
  if (form?.elements.ordem) form.elements.ordem.value = 0;
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
}

function resetAddonForm(form = $("#addon-form")) {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.aplicarEm) form.elements.aplicarEm.value = "todos";
  setAddonCategorySelection([]);
  if (form?.elements.produtoId) form.elements.produtoId.value = "";
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
}

function resetProductForm(form = $("#product-form")) {
  const currentCategory = form?.elements.categoriaId?.value || "";
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.categoriaId && currentCategory) form.elements.categoriaId.value = currentCategory;
  if (form?.elements.preco) form.elements.preco.value = 0;
  if (form?.elements.tipoProduto) form.elements.tipoProduto.value = "simples";
  if (form?.elements.regraPreco) form.elements.regraPreco.value = "fixo";
  if (form?.elements.maxSabores) form.elements.maxSabores.value = 1;
  if (form?.elements.pizzaMode) form.elements.pizzaMode.checked = false;
  if (form?.elements.pizzaTamanhosTexto) form.elements.pizzaTamanhosTexto.value = "";
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
  if (form?.elements.permiteObservacoes) form.elements.permiteObservacoes.checked = true;
  renderPhotoPreview("");
  document.querySelectorAll(".product-list-item").forEach((element) => element.classList.remove("editing"));
}

function fillCategory(id) {
  const item = state.categories.find((category) => category.id === id);
  const form = $("#category-form");
  if (!item) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.descricao.value = item.descricao || "";
  form.elements.ordem.value = item.ordem || 0;
  form.elements.ativo.checked = item.ativo !== false;
}

function fillFlavor(id) {
  const item = state.flavors.find((flavor) => flavor.id === id);
  const form = $("#flavor-form");
  if (!item) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.preco.value = item.preco || 0;
  form.elements.categoriaId.value = item.categoriaId || "";
  form.elements.ordem.value = item.ordem || 0;
  form.elements.disponivel.checked = item.disponivel !== false;
}

function fillAddon(id) {
  const item = state.addons.find((addon) => addon.id === id);
  const form = $("#addon-form");
  if (!item) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.preco.value = item.preco || 0;
  form.elements.aplicarEm.value = item.aplicarEm || "todos";
  setAddonCategorySelection(addonCategoryIds(item));
  form.elements.produtoId.value = item.produtoId || "";
  form.elements.disponivel.checked = item.disponivel !== false;
}

function fillProduct(id) {
  const item = state.products.find((product) => product.id === id);
  const form = $("#product-form");
  if (!item) return;
  ["id", "nome", "descricao", "categoriaId", "preco", "tipoProduto", "maxSabores", "regraPreco", "fotoUrl"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = key === "id" ? id : item[key] || "";
  });
  form.elements.tipoProduto.value = item.tipoProduto || "simples";
  form.elements.maxSabores.value = item.maxSabores || 1;
  form.elements.regraPreco.value = item.regraPreco || "fixo";
  if (form.elements.pizzaMode) form.elements.pizzaMode.checked = Boolean(item.pizzaMode);
  if (form.elements.pizzaTamanhosTexto) form.elements.pizzaTamanhosTexto.value = pizzaSizesToText(item.pizzaTamanhos);
  form.elements.disponivel.checked = item.disponivel !== false;
  form.elements.destaque.checked = Boolean(item.destaque);
  form.elements.permiteObservacoes.checked = item.permiteObservacoes !== false;
  renderPhotoPreview(item.fotoUrl || "");
  document.querySelectorAll(".product-list-item").forEach((element) => element.classList.remove("editing"));
  document.querySelector(`[data-edit-product="${id}"]`)?.closest(".product-list-item")?.classList.add("editing");
}

async function toggleProductHighlight(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  await updateDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
    destaque: !Boolean(product.destaque),
    atualizadoEm: serverTimestamp()
  });
  await loadProducts();
}

async function toggleProductAvailability(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  const scrollTop = window.scrollY;
  await updateDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
    disponivel: product.disponivel === false,
    atualizadoEm: serverTimestamp()
  });
  await loadProducts();
  window.scrollTo({ top: scrollTop });
}

async function updateProductPhoto(id, file, input) {
  if (!file) return;
  const base64 = await imageFileToBase64(file, input, { maxDimension: 900, quality: 0.82 });
  if (!base64) return;
  const scrollTop = window.scrollY;
  await updateDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
    fotoUrl: base64,
    atualizadoEm: serverTimestamp()
  });
  const form = $("#product-form");
  if (form.elements.id.value === id) {
    form.elements.fotoUrl.value = base64;
    renderPhotoPreview(base64);
  }
  await loadProducts();
  window.scrollTo({ top: scrollTop });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageFileToBase64(file, input, options = {}) {
  if (!file.type.startsWith("image/")) {
    alert("Selecione uma imagem válida.");
    if (input) input.value = "";
    return "";
  }
  try {
    const base64 = await compressImageFile(file, options);
    if (base64.length > 750 * 1024) {
      alert("A imagem foi comprimida, mas ainda ficou pesada. Escolha uma imagem menor para salvar no perfil.");
      if (input) input.value = "";
      return "";
    }
    return base64;
  } catch (error) {
    console.warn("Não foi possível compactar a imagem:", error);
    const base64 = await fileToBase64(file);
    if (base64.length > 750 * 1024) {
      alert("Não foi possível compactar esta imagem. Escolha uma imagem menor para salvar em Base64.");
      if (input) input.value = "";
      return "";
    }
    return base64;
  }
}

function compressImageFile(file, options = {}) {
  const maxDimension = options.maxDimension || 900;
  const quality = options.quality || 0.82;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/webp", quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Imagem inválida"));
    };
    image.src = objectUrl;
  });
}

function renderPhotoPreview(src) {
  const preview = $("#product-photo-preview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${src}" alt="Prévia da foto do produto">` : "Sem foto selecionada";
}

async function loadSettings() {
  const snap = await getDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"));
  const data = snap.data() || {};
  const form = $("#settings-form");
  Array.from(form.elements).forEach((field) => {
    if (!field.name || field.type === "file") return;
    const value = data[field.name] ?? defaultSettings[field.name];
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? state.business[field.name] ?? "";
  });
  renderBusinessLogoPreview(form.elements.logoUrl?.value || "");
  renderDashboardLogo(form.elements.logoUrl?.value || "");
  renderDeliveryFeeRows(form.elements.entregaBairrosTaxas?.value || "");
}

$("#settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    syncDeliveryFeeRowsToField();
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"), formToObject(form), { merge: true });
    renderDashboardLogo(form.elements.logoUrl?.value || "");
  }, "Atualizações feitas");
});

function renderDeliveryFeeRows(rawValue = "") {
  const rows = parseDeliveryFeeLines(rawValue);
  const container = $("#delivery-fees-rows");
  if (!container) return;
  container.innerHTML = "";
  (rows.length ? rows : [{ bairro: "", valor: "" }]).forEach((row) => addDeliveryFeeRow(row));
}

function addDeliveryFeeRow(row = { bairro: "", valor: "" }) {
  const container = $("#delivery-fees-rows");
  if (!container) return;
  const element = document.createElement("div");
  element.className = "delivery-fee-row";
  element.innerHTML = `
    <label>Bairro<input data-delivery-area="bairro" value="${escapeAttr(row.bairro || "")}" placeholder="Ex: Centro"></label>
    <label>Valor<input data-delivery-area="valor" type="number" step="0.01" value="${escapeAttr(row.valor || "")}" placeholder="Ex: 5.00"></label>
    <button class="btn btn-small" type="button" data-remove-delivery-row>Remover</button>
  `;
  element.querySelector("[data-remove-delivery-row]").addEventListener("click", () => {
    element.remove();
    if (!container.children.length) addDeliveryFeeRow();
  });
  container.appendChild(element);
}

function syncDeliveryFeeRowsToField() {
  const form = $("#settings-form");
  const rows = Array.from(document.querySelectorAll(".delivery-fee-row")).map((row) => {
    const bairro = row.querySelector("[data-delivery-area='bairro']")?.value.trim();
    const valor = row.querySelector("[data-delivery-area='valor']")?.value.trim();
    return bairro && valor ? `${bairro}=${valor}` : "";
  }).filter(Boolean);
  if (form?.elements.entregaBairrosTaxas) form.elements.entregaBairrosTaxas.value = rows.join("\n");
}

function parseDeliveryFeeLines(rawValue = "") {
  return String(rawValue || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [bairro, valor] = line.split(/[=:;]/);
      return { bairro: bairro?.trim() || "", valor: valor?.trim() || "" };
    })
    .filter((row) => row.bairro || row.valor);
}

function escapeAttr(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function setFormUpdating(form, active, text = "Atualizando...") {
  if (!form) return;
  let overlay = form.querySelector(".form-saving-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "form-saving-overlay";
    form.appendChild(overlay);
  }
  overlay.textContent = text;
  form.classList.toggle("is-updating", active);
}

async function runFormSave(form, action, successText = "Salvo com sucesso") {
  try {
    setFormUpdating(form, true, "Atualizando...");
    await action();
    setFormUpdating(form, true, successText);
    setTimeout(() => setFormUpdating(form, false), 900);
  } catch (error) {
    setFormUpdating(form, false);
    alert(`Não foi possível salvar: ${error.message}`);
  }
}

function renderBusinessLogoPreview(src) {
  const preview = $("#business-logo-preview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${src}" alt="Prévia do logo do estabelecimento">` : "Sem logo selecionado";
}

async function loadFees() {
  const snap = await getDoc(doc(db, `estabelecimentos/${state.businessId}/taxas`, "padrao"));
  const data = snap.data() || {};
  const form = $("#fees-form");
  Object.entries(data).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (form.elements[key].type === "checkbox") form.elements[key].checked = Boolean(value);
    else form.elements[key].value = value || 0;
  });
}

$("#fees-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await runFormSave(form, async () => {
    const data = formToObject(form);
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/taxas`, "padrao"), {
      creditoPercentual: numberValue(data.creditoPercentual),
      debitoPercentual: numberValue(data.debitoPercentual),
      pixPercentual: numberValue(data.pixPercentual),
      dinheiroPercentual: numberValue(data.dinheiroPercentual),
      pixFixo: numberValue(data.pixFixo),
      dinheiroFixo: numberValue(data.dinheiroFixo),
      somarAoPedido: Boolean(data.somarAoPedido)
    }, { merge: true });
  });
});
