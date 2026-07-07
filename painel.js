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
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { addMonths, formToObject, money, numberValue, planMonths, printOrder, setMessage, toBrazilDate } from "./utils.js";
import { renderFinanceSummary } from "./financeiro.js";
import { fillCoordinatesFromAddress } from "./geocoding.js";

const state = { businessId: "", business: null, settings: {}, categories: [], products: [], flavors: [], addons: [], orders: [], clients: [], orderSearch: "", productSearch: "", dashboardPeriod: "today", financePeriod: "today", knownOrderIds: new Set(), ordersLoadedOnce: false };
const $ = (selector) => document.querySelector(selector);
let unsubscribeOrders = null;
let notificationAudioCtx = null;
const panelPages = ["dashboard", "pedidos", "produtos", "produtos-simples", "pizzas", "porcoes", "categorias", "sabores", "bordas", "adicionais", "clientes", "financeiro", "taxas", "configuracoes", "delivery"];
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
    showCurrentPanelPage();
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
document.addEventListener("pointerdown", unlockNotificationSound, { once: true });
$("#refresh-orders")?.addEventListener("click", loadOrders);
$("#order-search")?.addEventListener("input", (event) => {
  state.orderSearch = event.target.value.trim().toLowerCase();
  renderOrders();
});
$("#all-products-search")?.addEventListener("input", (event) => {
  state.productSearch = event.target.value.trim().toLowerCase();
  renderAllProductsOverview();
});
$("#dashboard-period")?.addEventListener("change", (event) => {
  state.dashboardPeriod = event.target.value;
  renderDashboard();
});
$("#finance-period")?.addEventListener("change", (event) => {
  state.financePeriod = event.target.value;
  renderFinanceSummary("#finance-summary", ordersForPeriod(state.financePeriod));
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
$("#simple-product-photo-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const base64 = await imageFileToBase64(file, event.target, { maxDimension: 900, quality: 0.82 });
  if (!base64) return;
  const form = $("#simple-product-form");
  form.elements.fotoUrl.value = base64;
  renderSimpleProductPhotoPreview(base64);
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
window.addEventListener("hashchange", showCurrentPanelPage);
document.querySelectorAll(".sidebar nav a").forEach((link) => {
  link.addEventListener("click", () => setTimeout(showCurrentPanelPage, 0));
});

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

function showCurrentPanelPage() {
  const page = panelPages.includes(location.hash.replace("#", "")) ? location.hash.replace("#", "") : "dashboard";
  document.querySelectorAll("main > section").forEach((section) => {
    const isUtilityBand = section.classList.contains("soon-band")
      || section.classList.contains("dashboard-toolbar")
      || section.classList.contains("dashboard-insights")
      || section.classList.contains("dashboard-tips");
    const isPage = panelPages.includes(section.id);
    if (isPage) section.classList.toggle("hidden", section.id !== page);
    if (isUtilityBand) section.classList.toggle("hidden", page !== "dashboard");
  });
  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${page}`);
  });
  if (page === "adicionais") syncModuleAddonApplyMode();
}

async function loadPanelData() {
  await loadCategories();
  await loadProducts();
  await Promise.all([loadFlavors(), loadAddons(), loadOrders(), loadClients(), loadSettings(), loadFees()]);
  renderModuleProducts();
  renderModuleFlavors();
  renderModuleAddons();
}

async function loadCategories() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/categorias`), orderBy("ordem", "asc")));
  state.categories = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const categoryOptions = state.categories.map((item) => `<option value="${item.id}">${item.nome}</option>`).join("");
  $("#product-category").innerHTML = categoryOptions;
  if ($("#simple-product-category")) $("#simple-product-category").innerHTML = categoryOptions;
  $("#flavor-category").innerHTML = categoryOptions;
  ["#pizza-source-small", "#pizza-source-medium", "#pizza-source-large"].forEach((selector) => {
    if ($(selector)) $(selector).innerHTML = `<option value="">Não usar</option>${categoryOptions}`;
  });
  renderAddonCategoryChecks();
  renderModuleAddonCategoryChecks();
  if (location.hash.replace("#", "") === "adicionais") syncModuleAddonApplyMode();
  $("#categories-list").innerHTML = state.categories.map((item) => `
    <div class="list-item">
      <strong>${item.nome}</strong><small>${item.ativo ? "Ativo" : "Inativo"} - ordem ${item.ordem || 0}</small>
      <button class="btn btn-small" data-edit-category="${item.id}" type="button">Editar</button>
    </div>
  `).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => fillCategory(button.dataset.editCategory)));
  renderModuleCategories();
  renderAllProductsOverview();
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
  renderModuleFlavors();
  renderAllProductsOverview();
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
  renderModuleAddons();
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
  renderModuleProducts();
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

function simpleProducts() {
  return state.products.filter((item) => item.moduleType === "simples");
}

function moduleItems(type) {
  return state.flavors.filter((item) => item.tipo === type || item.moduleType === type);
}

function crusts() {
  return state.addons.filter((item) => item.tipoAdicional === "borda");
}

function extraAddons() {
  return state.addons.filter((item) => item.tipoAdicional !== "borda");
}

function renderModuleProducts() {
  renderAllProductsOverview();
  renderSimpleProducts();
  renderPizzas();
  renderPortions();
}

function renderAllProductsOverview() {
  const target = $("#all-products-list");
  if (!target) return;
  const queryText = normalizeName(state.productSearch);
  const items = allCatalogItems().filter((item) => {
    if (!queryText) return true;
    return [item.nome, item.categoria, item.tipo, item.descricao]
      .some((value) => normalizeName(value).includes(queryText));
  });
  if (!items.length) {
    target.innerHTML = "<p>Nenhum produto encontrado.</p>";
    return;
  }
  const groups = items.reduce((map, item) => {
    const key = item.categoria || "Sem categoria";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
  target.innerHTML = Array.from(groups.entries()).map(([category, products]) => `
    <section class="catalog-group">
      <div class="catalog-group-heading">
        <strong>${category}</strong>
        <span>${products.length} item(ns)</span>
      </div>
      <div class="catalog-cards">
        ${products.map(renderCatalogCard).join("")}
      </div>
    </section>
  `).join("");
  bindModuleActions(target);
}

function allCatalogItems() {
  const simpleItems = simpleProducts().map((item) => ({
    id: item.id,
    nome: item.nome || "Produto sem nome",
    descricao: item.descricao || "",
    categoria: categoryName(item.categoriaId),
    tipo: "Produto simples",
    preco: item.preco,
    disponivel: item.disponivel !== false,
    edit: "simple-product"
  }));
  const pizzaItems = moduleItems("pizza").map((item) => ({
    id: item.id,
    nome: item.nome || "Pizza sem nome",
    descricao: item.descricao || "",
    categoria: "Pizzas",
    tipo: "Pizza",
    preco: item.valorP ?? item.precoP ?? item.preco,
    valorG: item.valorG ?? item.precoG ?? item.preco,
    disponivel: item.disponivel !== false,
    edit: "pizza-item"
  }));
  const portionItems = moduleItems("porcao").map((item) => ({
    id: item.id,
    nome: item.nome || "Porção sem nome",
    descricao: item.descricao || "",
    categoria: "Porções",
    tipo: "Porção",
    preco: item.valorP ?? item.precoP ?? item.preco,
    valorG: item.valorG ?? item.precoG ?? item.preco,
    disponivel: item.disponivel !== false,
    edit: "portion-item"
  }));
  return [...simpleItems, ...pizzaItems, ...portionItems];
}

function renderCatalogCard(item) {
  const price = item.valorG !== undefined
    ? `P ${money(item.preco)} | G ${money(item.valorG)}`
    : money(item.preco);
  return `
    <article class="catalog-card ${item.disponivel ? "" : "is-disabled"}">
      <div>
        <span class="catalog-type">${item.tipo}</span>
        <strong>${item.nome}</strong>
        ${item.descricao ? `<small>${item.descricao}</small>` : ""}
      </div>
      <div class="catalog-card-side">
        <b>${price}</b>
        <span>${item.disponivel ? "Ativo" : "Inativo"}</span>
        <button class="btn btn-small" data-module-edit="${item.edit}" data-id="${item.id}" type="button">Editar</button>
      </div>
    </article>
  `;
}

function renderSimpleProducts() {
  const target = $("#simple-products-list");
  if (!target) return;
  target.innerHTML = simpleProducts().map((item) => moduleListItem({
    title: item.nome,
    meta: `${money(item.preco)} - ${categoryName(item.categoriaId)} - ${item.disponivel !== false ? "Ativo" : "Inativo"}`,
    id: item.id,
    edit: "simple-product",
    remove: "product"
  })).join("") || "<p>Nenhum produto simples cadastrado.</p>";
  bindModuleActions(target);
}

function renderPizzas() {
  const target = $("#pizzas-list");
  if (!target) return;
  target.innerHTML = moduleItems("pizza").map((item) => moduleListItem({
    title: item.nome,
    meta: `P: ${money(item.valorP ?? item.precoP ?? item.preco)} - G: ${money(item.valorG ?? item.precoG ?? item.preco)} - ${item.disponivel !== false ? "Ativo" : "Inativo"}`,
    description: item.descricao || "",
    id: item.id,
    edit: "pizza-item",
    remove: "flavor"
  })).join("") || "<p>Nenhuma pizza cadastrada.</p>";
  bindModuleActions(target);
}

function renderPortions() {
  const target = $("#portions-list");
  if (!target) return;
  target.innerHTML = moduleItems("porcao").map((item) => moduleListItem({
    title: item.nome,
    meta: `P: ${money(item.valorP ?? item.precoP ?? item.preco)} - G: ${money(item.valorG ?? item.precoG ?? item.preco)} - ${item.disponivel !== false ? "Ativo" : "Inativo"}`,
    description: item.descricao || "",
    id: item.id,
    edit: "portion-item",
    remove: "flavor"
  })).join("") || "<p>Nenhuma porção cadastrada.</p>";
  bindModuleActions(target);
}

function renderModuleCategories() {
  const target = $("#module-categories-list");
  if (!target) return;
  target.innerHTML = state.categories.map((item) => moduleListItem({
    title: item.nome,
    meta: `${moduleTypeLabel(item.moduleType)} - ${item.ativo !== false ? "Ativa" : "Inativa"} - ordem ${item.ordem || 0}`,
    id: item.id,
    edit: "module-category",
    remove: "category"
  })).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  bindModuleActions(target);
}

function renderModuleFlavors() {
  const target = $("#module-flavors-list");
  if (!target) return;
  const items = state.flavors.filter((item) => item.tipo === "pizza" || item.tipo === "porcao" || item.moduleType === "pizza" || item.moduleType === "porcao");
  target.innerHTML = items.map((item) => moduleListItem({
    title: item.nome,
    meta: `${moduleTypeLabel(item.tipo || item.moduleType)} - P: ${money(item.valorP ?? item.precoP ?? item.preco)} - G: ${money(item.valorG ?? item.precoG ?? item.preco)} - ${item.disponivel !== false ? "Ativo" : "Inativo"}`,
    description: item.descricao || "",
    id: item.id,
    edit: "module-flavor",
    remove: "flavor"
  })).join("") || "<p>Nenhum sabor cadastrado.</p>";
  bindModuleActions(target);
}

function renderModuleAddons() {
  renderCrusts();
  renderExtras();
}

function renderCrusts() {
  const target = $("#crusts-list");
  if (!target) return;
  const items = [{ id: "", nome: "Sem borda", preco: 0, disponivel: true, fixed: true }, ...crusts()];
  target.innerHTML = items.map((item) => item.fixed ? `
    <article class="list-item"><strong>Sem borda</strong><small>${money(0)} - padrão obrigatório</small></article>
  ` : moduleListItem({
    title: item.nome,
    meta: `${money(item.preco)} - ${item.disponivel !== false ? "Ativa" : "Inativa"}`,
    id: item.id,
    edit: "crust",
    remove: "addon"
  })).join("");
  bindModuleActions(target);
}

function renderExtras() {
  const target = $("#module-addons-list");
  if (!target) return;
  target.innerHTML = extraAddons().map((item) => moduleListItem({
    title: item.nome,
    meta: `${money(item.preco)} - ${moduleAddonScopeText(item)} - ${item.disponivel !== false ? "Ativo" : "Inativo"}`,
    id: item.id,
    edit: "module-addon",
    remove: "addon"
  })).join("") || "<p>Nenhum adicional cadastrado.</p>";
  bindModuleActions(target);
}

function moduleListItem({ title, meta, description = "", id, edit, remove }) {
  return `
    <article class="list-item module-list-item">
      <div>
        <strong>${title || ""}</strong>
        <small>${meta || ""}</small>
        ${description ? `<small>${description}</small>` : ""}
      </div>
      <div class="item-actions">
        <button class="btn btn-small" data-module-edit="${edit}" data-id="${id}" type="button">Editar</button>
        <button class="btn btn-small" data-module-delete="${remove}" data-id="${id}" type="button">Excluir</button>
      </div>
    </article>
  `;
}

function bindModuleActions(root = document) {
  root.querySelectorAll("[data-module-edit]").forEach((button) => {
    button.addEventListener("click", () => editModuleItem(button.dataset.moduleEdit, button.dataset.id));
  });
  root.querySelectorAll("[data-module-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteModuleItem(button.dataset.moduleDelete, button.dataset.id));
  });
}

function moduleTypeLabel(value = "") {
  if (value === "pizza") return "Pizza";
  if (value === "porcao") return "Porção";
  if (value === "simples") return "Produto simples";
  return "Geral";
}

function moduleAddonScope(value = "") {
  if (value === "pizza") return "Pizzas";
  if (value === "porcao") return "Porções";
  if (value === "simples") return "Produtos simples";
  return "Todos";
}

function moduleAddonScopeText(addon) {
  if (addon.aplicarPor === "categoria") {
    const names = addonCategoryIds(addon).map(categoryName).filter(Boolean);
    return `Categorias: ${names.join(", ") || "nenhuma"}`;
  }
  const modules = Array.isArray(addon.modulos) && addon.modulos.length ? addon.modulos : [addon.aplicarEm || "todos"];
  if (modules.includes("todos")) return "Todos os módulos";
  return `Módulos: ${modules.map(moduleAddonScope).join(", ")}`;
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

function renderModuleAddonCategoryChecks(selected = []) {
  const target = $("#module-addon-category-checks");
  if (!target) return;
  const selectedSet = new Set(selected);
  target.innerHTML = state.categories.map((category) => `
    <label class="category-check ${selectedSet.has(category.id) ? "is-selected" : ""}">
      <input type="checkbox" data-module-addon-category-id="${category.id}" ${selectedSet.has(category.id) ? "checked" : ""}>
      <span>${category.nome}</span>
    </label>
  `).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  target.querySelectorAll("[data-module-addon-category-id]").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest(".category-check")?.classList.toggle("is-selected", input.checked);
    });
  });
}

function selectedModuleAddonCategoryIds() {
  return Array.from(document.querySelectorAll("[data-module-addon-category-id]:checked")).map((input) => input.dataset.moduleAddonCategoryId);
}

function selectedModuleAddonModules() {
  return Array.from(document.querySelectorAll("[data-module-addon-module]:checked")).map((input) => input.dataset.moduleAddonModule);
}

function setModuleAddonModules(values = ["pizza"]) {
  const selected = new Set(values?.length ? values : ["pizza"]);
  document.querySelectorAll("[data-module-addon-module]").forEach((input) => {
    input.checked = selected.has(input.dataset.moduleAddonModule);
    input.closest(".category-check")?.classList.toggle("is-selected", input.checked);
  });
}

function setModuleAddonApplyMode(value = "modulo") {
  const form = $("#module-addon-form");
  if (form?.elements.aplicarPor) form.elements.aplicarPor.value = value;
  if (value === "categoria") renderModuleAddonCategoryChecks(selectedModuleAddonCategoryIds());
  document.querySelectorAll("[data-module-addon-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.moduleAddonPanel !== value);
  });
}

function syncModuleAddonApplyMode() {
  const value = $("#module-addon-apply-mode")?.value || "modulo";
  setModuleAddonApplyMode(value);
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
      const addedOrders = snap.docChanges()
        .filter((change) => change.type === "added" && state.ordersLoadedOnce && !state.knownOrderIds.has(change.doc.id))
        .map((change) => ({ id: change.doc.id, ...change.doc.data() }));
      state.orders = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      state.knownOrderIds = new Set(state.orders.map((order) => order.id));
      renderOrders();
      renderDashboard();
      updateOrdersNotification(addedOrders);
      renderFinanceSummary("#finance-summary", ordersForPeriod(state.financePeriod));
      state.ordersLoadedOnce = true;
      resolve();
    }, reject);
  });
}

function updateOrdersNotification(newOrders = []) {
  const pending = state.orders.filter((order) => normalizeStatus(order.status || "Aguardando aprovação") === normalizeStatus("Aguardando aprovação")).length;
  let badge = $("#orders-menu-badge");
  const ordersLink = document.querySelector('.sidebar nav a[href="#pedidos"]');
  if (!badge && ordersLink) {
    ordersLink.insertAdjacentHTML("beforeend", '<span id="orders-menu-badge" class="nav-badge hidden">0</span>');
    badge = $("#orders-menu-badge");
  }
  if (badge) {
    badge.textContent = String(pending);
    badge.classList.toggle("hidden", pending <= 0);
  }
  document.title = pending > 0 ? `(${pending}) BQ Menu` : "BQ Menu";
  if (newOrders.length) {
    playOrderNotification();
    showPanelNotice(`${newOrders.length} novo${newOrders.length > 1 ? "s" : ""} pedido${newOrders.length > 1 ? "s" : ""}`);
  }
}

function showPanelNotice(text) {
  let notice = $("#panel-order-notice");
  if (!notice) {
    document.body.insertAdjacentHTML("beforeend", '<div id="panel-order-notice" class="panel-order-notice"></div>');
    notice = $("#panel-order-notice");
  }
  notice.textContent = text;
  notice.classList.add("show");
  clearTimeout(showPanelNotice.timer);
  showPanelNotice.timer = setTimeout(() => notice.classList.remove("show"), 4200);
}

function unlockNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    notificationAudioCtx = notificationAudioCtx || new AudioContext();
    notificationAudioCtx.resume?.();
  } catch (error) {
    console.warn("Som de notificação indisponível:", error);
  }
}

function playOrderNotification() {
  try {
    unlockNotificationSound();
    if (!notificationAudioCtx) return;
    const now = notificationAudioCtx.currentTime;
    [0, 0.18].forEach((offset) => {
      const oscillator = notificationAudioCtx.createOscillator();
      const gain = notificationAudioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.14);
      oscillator.connect(gain);
      gain.connect(notificationAudioCtx.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.16);
    });
  } catch (error) {
    console.warn("Não foi possível tocar alerta de pedido:", error);
  }
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
    item.bordas?.length ? `borda: ${item.bordas.map((addon) => addon.nome).join("/")}` : "",
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
  enhanceDashboardHelp();
  const periodOrders = ordersForDashboardPeriod();
  const validOrders = periodOrders.filter((order) => normalizeStatus(order.status) !== normalizeStatus("Cancelado"));
  const total = validOrders.reduce((sum, order) => sum + Number(order.totalFinal || 0), 0);
  const open = state.orders.filter((order) => !["Entregue", "Cancelado"].includes(order.status)).length;
  const completed = periodOrders.filter((order) => normalizeStatus(order.status) === normalizeStatus("Entregue")).length;
  const cancelled = periodOrders.filter((order) => normalizeStatus(order.status) === normalizeStatus("Cancelado")).length;
  const cancellationRate = periodOrders.length ? Math.round((cancelled / periodOrders.length) * 100) : 0;
  const topProduct = topOrderItem(validOrders);
  const topClient = topOrderClient(validOrders);
  const topDelivery = topOrderField(validOrders, "tipoEntrega");
  $("#orders-today").textContent = periodOrders.length;
  $("#sales-today").textContent = money(total);
  $("#orders-open").textContent = open;
  $("#average-ticket").textContent = money(validOrders.length ? total / validOrders.length : 0);
  setText("#orders-completed", completed);
  setText("#cancellation-rate", `${cancellationRate}%`);
  setText("#new-clients", newClientsInPeriod(periodOrders));
  setText("#top-product", topProduct?.name || "--");
  setText("#top-product-detail", topProduct ? `${topProduct.count} item(ns) vendidos - ${money(topProduct.total)}` : "Sem pedidos no periodo.");
  setText("#top-client", topClient?.name || "--");
  setText("#top-client-detail", topClient ? `${topClient.count} pedido(s) - ${money(topClient.total)}` : "Sem pedidos no periodo.");
  setText("#top-delivery-type", topDelivery?.name || "--");
  setText("#top-delivery-detail", topDelivery ? `${topDelivery.count} pedido(s) no periodo.` : "Retirada, entrega ou consumo no local.");
  renderDashboardTips({ periodOrders, validOrders, topProduct, topClient, cancellationRate });
}

function enhanceDashboardHelp() {
  const helps = {
    "orders-today": "Quantidade de pedidos no periodo selecionado.",
    "sales-today": "Soma dos pedidos nao cancelados no periodo.",
    "orders-open": "Pedidos que ainda precisam de acao: aceitar, preparar ou entregar.",
    "average-ticket": "Valor medio de cada pedido vendido.",
    "next-renewal": "Data estimada da proxima renovacao do plano."
  };
  Object.entries(helps).forEach(([id, title]) => {
    const card = document.getElementById(id)?.closest(".metric-card");
    const label = card?.querySelector("span");
    if (!label || label.querySelector(".help-dot")) return;
    label.insertAdjacentHTML("beforeend", ` <button class="help-dot" title="${title}" type="button">?</button>`);
  });
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function ordersForDashboardPeriod() {
  return ordersForPeriod(state.dashboardPeriod);
}

function ordersForPeriod(period = "today") {
  if (period === "all") return state.orders;
  const days = period === "today" ? 0 : Number(period || 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (days > 0) start.setDate(start.getDate() - (days - 1));
  const startTime = start.getTime();
  return state.orders.filter((order) => orderDateTime(order) >= startTime);
}

function orderDateTime(order) {
  if (order.criadoEm?.toMillis) return order.criadoEm.toMillis();
  const date = order.criadoEm?.toDate ? order.criadoEm.toDate() : new Date(order.criadoEm || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function topOrderItem(orders) {
  const map = new Map();
  orders.forEach((order) => {
    (order.itens || []).forEach((item) => {
      const name = item.nome || "Produto";
      const current = map.get(name) || { name, count: 0, total: 0 };
      current.count += Number(item.quantidade || 1);
      current.total += Number(item.preco || 0) * Number(item.quantidade || 1);
      map.set(name, current);
    });
  });
  return [...map.values()].sort((a, b) => b.count - a.count || b.total - a.total)[0] || null;
}

function topOrderClient(orders) {
  const map = new Map();
  orders.forEach((order) => {
    const key = order.whatsapp || order.clienteNome || order.id;
    if (!key) return;
    const current = map.get(key) || { name: order.clienteNome || order.whatsapp || "Cliente", count: 0, total: 0 };
    current.count += 1;
    current.total += Number(order.totalFinal || 0);
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count)[0] || null;
}

function topOrderField(orders, field) {
  const map = new Map();
  orders.forEach((order) => {
    const name = order[field] || "Nao informado";
    const current = map.get(name) || { name, count: 0 };
    current.count += 1;
    map.set(name, current);
  });
  return [...map.values()].sort((a, b) => b.count - a.count)[0] || null;
}

function newClientsInPeriod(periodOrders) {
  const firstByClient = new Map();
  state.orders.forEach((order) => {
    const key = order.whatsapp || order.clienteNome;
    if (!key) return;
    const time = orderDateTime(order);
    if (!firstByClient.has(key) || time < firstByClient.get(key)) firstByClient.set(key, time);
  });
  const periodKeys = new Set(periodOrders.map((order) => order.whatsapp || order.clienteNome).filter(Boolean));
  return [...periodKeys].filter((key) => periodOrders.some((order) => (order.whatsapp || order.clienteNome) === key && firstByClient.get(key) === orderDateTime(order))).length;
}

function renderDashboardTips({ periodOrders, validOrders, topProduct, topClient, cancellationRate }) {
  const target = $("#dashboard-tips");
  if (!target) return;
  const tips = [];
  if (topProduct) tips.push(`Destaque "${topProduct.name}" no cardapio e use uma foto boa: ele ja provou que vende.`);
  if (topClient && topClient.count > 1) tips.push(`Chame ${topClient.name} no WhatsApp com uma oferta de recompra ou cupom simples.`);
  if (cancellationRate >= 20) tips.push("A taxa de cancelamento esta alta. Confira tempo de preparo, estoque e clareza dos itens.");
  if (!validOrders.length) tips.push("Ainda nao ha vendas no periodo. Publique produtos com foto e envie o link do cardapio para clientes antigos.");
  if (periodOrders.length && !tips.length) tips.push("O periodo esta saudavel. Acompanhe os mais vendidos para montar combos e promocoes.");
  target.innerHTML = `<div class="dashboard-tips-head"><strong>O que fazer agora</strong><span>${periodOrders.length} pedido(s) no periodo</span></div>${tips.map((tip) => `<p>${tip}</p>`).join("")}`;
}

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, `estabelecimentos/${state.businessId}/pedidos`, id), { status });
}

function printById(id, mode) {
  const order = state.orders.find((item) => item.id === id);
  if (order) printOrder(order, mode);
}

$("#simple-product-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSimpleProduct(event.currentTarget);
});

$("#pizza-item-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveModuleFlavor(event.currentTarget, "pizza", "Pizza salva");
});

$("#portion-item-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveModuleFlavor(event.currentTarget, "porcao", "Porção salva");
});

$("#module-flavor-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = event.currentTarget.elements.tipo.value || "pizza";
  await saveModuleFlavor(event.currentTarget, type, "Sabor salvo");
});

$("#module-category-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveModuleCategory(event.currentTarget);
});

$("#crust-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveModuleAddon(event.currentTarget, "borda", "pizza", "Borda salva");
});

$("#module-addon-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  await saveModuleAddon(form, "adicional", "", "Adicional salvo");
});
$("#module-addon-apply-mode")?.addEventListener("change", (event) => setModuleAddonApplyMode(event.target.value));
document.addEventListener("change", (event) => {
  if (event.target?.id === "module-addon-apply-mode") setModuleAddonApplyMode(event.target.value);
});
document.addEventListener("input", (event) => {
  if (event.target?.id === "module-addon-apply-mode") setModuleAddonApplyMode(event.target.value);
});
document.querySelectorAll("[data-module-addon-module]").forEach((input) => {
  input.addEventListener("change", () => input.closest(".category-check")?.classList.toggle("is-selected", input.checked));
});

$("#new-simple-product-btn")?.addEventListener("click", () => saveDraftOrReset($("#simple-product-form"), () => saveSimpleProduct($("#simple-product-form")), () => resetSimpleProductForm($("#simple-product-form"))));
$("#new-pizza-btn")?.addEventListener("click", () => saveDraftOrReset($("#pizza-item-form"), () => saveModuleFlavor($("#pizza-item-form"), "pizza", "Pizza salva"), () => resetModuleFlavorForm($("#pizza-item-form"), "pizza")));
$("#new-portion-btn")?.addEventListener("click", () => saveDraftOrReset($("#portion-item-form"), () => saveModuleFlavor($("#portion-item-form"), "porcao", "Porção salva"), () => resetModuleFlavorForm($("#portion-item-form"), "porcao")));
$("#new-category-btn")?.addEventListener("click", () => saveDraftOrReset($("#module-category-form"), () => saveModuleCategory($("#module-category-form")), () => resetModuleCategoryForm($("#module-category-form"))));
$("#new-flavor-btn")?.addEventListener("click", () => saveDraftOrReset($("#module-flavor-form"), () => saveModuleFlavor($("#module-flavor-form"), $("#module-flavor-form")?.elements.tipo.value || "pizza", "Sabor salvo"), () => resetModuleFlavorForm($("#module-flavor-form"), $("#module-flavor-form")?.elements.tipo.value || "pizza")));
$("#new-crust-btn")?.addEventListener("click", () => saveDraftOrReset($("#crust-form"), () => saveModuleAddon($("#crust-form"), "borda", "pizza", "Borda salva"), () => resetModuleAddonForm($("#crust-form"))));
$("#new-extra-btn")?.addEventListener("click", () => saveDraftOrReset($("#module-addon-form"), () => saveModuleAddon($("#module-addon-form"), "adicional", "", "Adicional salvo"), () => resetModuleAddonForm($("#module-addon-form"))));

async function saveDraftOrReset(form, saveAction, resetAction) {
  if (!form) return;
  if (!formHasDraft(form)) {
    resetAction();
    focusFirstField(form);
    return;
  }
  if (!form.reportValidity()) return;
  await saveAction();
  focusFirstField(form);
}

function formHasDraft(form) {
  const ignoredNames = new Set(["id", "disponivel", "ativo", "fotoUrl"]);
  return Array.from(form.elements).some((field) => {
    if (!field.name || ignoredNames.has(field.name)) return false;
    if (field.type === "checkbox" || field.type === "radio" || field.type === "button" || field.type === "submit") return false;
    if (field.tagName === "SELECT") return false;
    return String(field.value || "").trim() !== "";
  });
}

function focusFirstField(form) {
  const field = Array.from(form.elements).find((item) => item.name && !["hidden", "checkbox", "button", "submit"].includes(item.type));
  field?.focus();
}

async function saveSimpleProduct(form) {
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
      nome: data.nome,
      descricao: data.descricao || "",
      categoriaId: data.categoriaId || "",
      preco: numberValue(data.preco),
      fotoUrl: data.fotoUrl || "",
      tipoProduto: "simples",
      moduleType: "simples",
      disponivel: Boolean(data.disponivel),
      destaque: false,
      permiteObservacoes: true,
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetSimpleProductForm(form);
    await loadProducts();
  }, "Produto salvo");
}

async function saveModuleCategory(form) {
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/categorias`, id), {
      nome: data.nome,
      moduleType: data.moduleType || "simples",
      ordem: Number(data.ordem || 0),
      ativo: Boolean(data.ativo),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetModuleCategoryForm(form);
    await loadCategories();
  }, "Categoria salva");
}

async function saveModuleFlavor(form, type, successText) {
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    await persistInlineModuleSettings(form, type);
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/sabores`, id), {
      nome: data.nome,
      descricao: data.descricao || "",
      tipo: type,
      moduleType: type,
      valorP: numberValue(data.valorP),
      valorG: numberValue(data.valorG),
      preco: numberValue(data.valorP),
      precosPorTamanho: {
        P: numberValue(data.valorP),
        G: numberValue(data.valorG)
      },
      disponivel: Boolean(data.disponivel),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    const savedItem = {
      id,
      nome: data.nome,
      descricao: data.descricao || "",
      tipo: type,
      moduleType: type,
      valorP: numberValue(data.valorP),
      valorG: numberValue(data.valorG),
      preco: numberValue(data.valorP),
      precosPorTamanho: {
        P: numberValue(data.valorP),
        G: numberValue(data.valorG)
      },
      disponivel: Boolean(data.disponivel)
    };
    state.flavors = [
      savedItem,
      ...state.flavors.filter((item) => item.id !== id)
    ].sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));
    renderModuleFlavors();
    renderModuleProducts();
    resetModuleFlavorForm(form, type);
    await loadFlavors();
  }, successText);
}

async function persistInlineModuleSettings(form, type) {
  const keys = type === "pizza"
    ? ["pizzaMeioP", "pizzaMeioG"]
    : type === "porcao"
      ? ["porcaoMeioP", "porcaoMeioG"]
      : [];
  if (!keys.length || !form) return;
  const payload = {};
  keys.forEach((key) => {
    if (form.elements[key]) payload[key] = Boolean(form.elements[key].checked);
  });
  if (!Object.keys(payload).length) return;
  await setDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"), payload, { merge: true });
  state.settings = { ...state.settings, ...payload };
}

async function saveModuleAddon(form, tipoAdicional, aplicarEm, successText) {
  await runFormSave(form, async () => {
    const data = formToObject(form);
    const id = data.id || doc(collection(db, "tmp")).id;
    const aplicarPor = tipoAdicional === "borda" ? "modulo" : data.aplicarPor || "modulo";
    const modulos = tipoAdicional === "borda"
      ? ["pizza"]
      : aplicarPor === "modulo"
        ? selectedModuleAddonModules()
        : [];
    const categoriaIds = tipoAdicional === "borda" || aplicarPor !== "categoria" ? [] : selectedModuleAddonCategoryIds();
    if (tipoAdicional !== "borda" && aplicarPor === "modulo" && !modulos.length) {
      throw new Error("Selecione pelo menos um módulo para este adicional.");
    }
    if (tipoAdicional !== "borda" && aplicarPor === "categoria" && !categoriaIds.length) {
      throw new Error("Selecione pelo menos uma categoria para este adicional.");
    }
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/adicionais`, id), {
      nome: data.nome,
      preco: numberValue(data.preco),
      tipoAdicional,
      aplicarPor,
      aplicarEm: aplicarPor === "modulo" ? modulos[0] || "todos" : "categoria",
      modulos,
      categoriaId: "",
      categoriaIds,
      produtoId: "",
      disponivel: Boolean(data.disponivel),
      atualizadoEm: serverTimestamp()
    }, { merge: true });
    resetModuleAddonForm(form);
    await loadAddons();
  }, successText);
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

function resetSimpleProductForm(form = $("#simple-product-form")) {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.fotoUrl) form.elements.fotoUrl.value = "";
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
  renderSimpleProductPhotoPreview("");
}

function resetModuleFlavorForm(form, type = "pizza") {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.tipo) form.elements.tipo.value = type;
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
  applyInlineModuleSettings(form, type);
}

function applyInlineModuleSettings(form, type = "pizza") {
  if (!form) return;
  if (type === "pizza") {
    if (form.elements.pizzaMeioP) form.elements.pizzaMeioP.checked = Boolean(state.settings.pizzaMeioP);
    if (form.elements.pizzaMeioG) form.elements.pizzaMeioG.checked = Boolean(state.settings.pizzaMeioG);
  }
  if (type === "porcao") {
    if (form.elements.porcaoMeioP) form.elements.porcaoMeioP.checked = Boolean(state.settings.porcaoMeioP);
    if (form.elements.porcaoMeioG) form.elements.porcaoMeioG.checked = Boolean(state.settings.porcaoMeioG);
  }
}

function resetModuleCategoryForm(form = $("#module-category-form")) {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.ordem) form.elements.ordem.value = 0;
  if (form?.elements.ativo) form.elements.ativo.checked = true;
}

function resetModuleAddonForm(form) {
  form?.reset();
  if (form?.elements.id) form.elements.id.value = "";
  if (form?.elements.disponivel) form.elements.disponivel.checked = true;
  setModuleAddonApplyMode("modulo");
  setModuleAddonModules(["pizza"]);
  renderModuleAddonCategoryChecks([]);
}

function editModuleItem(kind, id) {
  if (kind === "product") return fillProduct(id);
  if (kind === "simple-product") return fillSimpleProduct(id);
  if (kind === "pizza-item") return fillModuleFlavor(id, $("#pizza-item-form"), "pizza", "pizzas");
  if (kind === "portion-item") return fillModuleFlavor(id, $("#portion-item-form"), "porcao", "porcoes");
  if (kind === "module-flavor") {
    const item = state.flavors.find((flavor) => flavor.id === id);
    return fillModuleFlavor(id, $("#module-flavor-form"), item?.tipo || item?.moduleType || "pizza", "sabores");
  }
  if (kind === "module-category") return fillModuleCategory(id);
  if (kind === "crust") return fillModuleAddon(id, $("#crust-form"), "bordas");
  if (kind === "module-addon") return fillModuleAddon(id, $("#module-addon-form"), "adicionais");
}

function fillSimpleProduct(id) {
  const item = state.products.find((product) => product.id === id);
  const form = $("#simple-product-form");
  if (!item || !form) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.preco.value = item.preco || 0;
  form.elements.categoriaId.value = item.categoriaId || "";
  form.elements.descricao.value = item.descricao || "";
  form.elements.fotoUrl.value = item.fotoUrl || "";
  form.elements.disponivel.checked = item.disponivel !== false;
  renderSimpleProductPhotoPreview(item.fotoUrl || "");
  location.hash = "produtos-simples";
  showCurrentPanelPage();
}

function fillModuleFlavor(id, form, type, page) {
  const item = state.flavors.find((flavor) => flavor.id === id);
  if (!item || !form) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  if (form.elements.tipo) form.elements.tipo.value = type;
  form.elements.valorP.value = item.valorP ?? item.precoP ?? item.preco ?? 0;
  form.elements.valorG.value = item.valorG ?? item.precoG ?? item.preco ?? 0;
  form.elements.descricao.value = item.descricao || "";
  form.elements.disponivel.checked = item.disponivel !== false;
  location.hash = page;
  showCurrentPanelPage();
}

function fillModuleCategory(id) {
  const item = state.categories.find((category) => category.id === id);
  const form = $("#module-category-form");
  if (!item || !form) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.moduleType.value = item.moduleType || "simples";
  form.elements.ordem.value = item.ordem || 0;
  form.elements.ativo.checked = item.ativo !== false;
  location.hash = "categorias";
  showCurrentPanelPage();
}

function fillModuleAddon(id, form, page) {
  const item = state.addons.find((addon) => addon.id === id);
  if (!item || !form) return;
  form.elements.id.value = id;
  form.elements.nome.value = item.nome || "";
  form.elements.preco.value = item.preco || 0;
  if (form.elements.aplicarPor) form.elements.aplicarPor.value = item.aplicarPor || (addonCategoryIds(item).length ? "categoria" : "modulo");
  setModuleAddonApplyMode(form.elements.aplicarPor?.value || "modulo");
  setModuleAddonModules(item.modulos || (item.aplicarEm && item.aplicarEm !== "categoria" ? [item.aplicarEm] : ["pizza"]));
  renderModuleAddonCategoryChecks(addonCategoryIds(item));
  form.elements.disponivel.checked = item.disponivel !== false;
  location.hash = page;
  showCurrentPanelPage();
}

async function deleteModuleItem(type, id) {
  if (!id || !confirm("Tem certeza que deseja excluir este item?")) return;
  const pathByType = {
    product: `estabelecimentos/${state.businessId}/produtos`,
    flavor: `estabelecimentos/${state.businessId}/sabores`,
    category: `estabelecimentos/${state.businessId}/categorias`,
    addon: `estabelecimentos/${state.businessId}/adicionais`
  };
  const path = pathByType[type];
  if (!path) return;
  await deleteDoc(doc(db, path, id));
  if (type === "product") await loadProducts();
  if (type === "flavor") await loadFlavors();
  if (type === "category") await loadCategories();
  if (type === "addon") await loadAddons();
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

function renderSimpleProductPhotoPreview(src) {
  const preview = $("#simple-product-photo-preview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${src}" alt="Prévia da imagem do produto">` : "Sem foto selecionada";
}

async function loadSettings() {
  const snap = await getDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"));
  const data = snap.data() || {};
  state.settings = data;
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
  fillModuleSettingsForms();
}

function fillModuleSettingsForms() {
  applyInlineModuleSettings($("#pizza-item-form"), "pizza");
  applyInlineModuleSettings($("#portion-item-form"), "porcao");
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
