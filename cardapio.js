import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  onSnapshot,
  query,
  where,
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
  flavors: [],
  addons: [],
  cart: [],
  buildingProduct: null,
  builderPizzaSize: null,
  builderFlavorMode: 1,
  clientOrders: [],
  clientUnsubscribe: null,
  deliveryFee: 0,
  deliveryRule: ""
};
const $ = (selector) => document.querySelector(selector);
let checkoutLookupTimer = null;
const businessDays = [
  ["domingo", "Domingo"],
  ["segunda", "Segunda"],
  ["terca", "Terça"],
  ["quarta", "Quarta"],
  ["quinta", "Quinta"],
  ["sexta", "Sexta"],
  ["sabado", "Sábado"]
];

init();

async function init() {
  if (!state.estabelecimentoId) {
    $("#menu-business-name").textContent = "Cardápio indisponível";
    $("#menu-message").textContent = "Informe o estabelecimento no link do cardápio.";
    return;
  }
  await Promise.all([loadBusiness(), loadSettings(), loadFees(), loadCategories(), loadProducts(), loadFlavors(), loadAddons()]);
  renderHeader();
  renderCategories();
  renderProducts();
  renderCart();
  renderDeliveryOptions();
  renderNeighborhoodOptions();
  restoreClientSession();
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

async function loadFlavors() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.estabelecimentoId}/sabores`), orderBy("nome", "asc")));
  state.flavors = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.disponivel !== false)
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || String(a.nome || "").localeCompare(String(b.nome || "")));
}

async function loadAddons() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.estabelecimentoId}/adicionais`), orderBy("nome", "asc")));
  state.addons = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.disponivel !== false);
}

function renderHeader() {
  const name = state.settings.nomePublico || state.business.nomeEstabelecimento || "Cardápio";
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
    return `<span>${label}: ${open && close ? `${open} às ${close}` : "Fechado"}</span>`;
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
  const tabs = [{ id: "todos", nome: "Todos" }, ...virtualCategories(), ...publicCategories()];
  $("#category-tabs").innerHTML = tabs.map((item) => `<button class="${item.id === activeId ? "active" : ""}" data-category="${item.id}">${item.nome}</button>`).join("");
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      renderCategories(button.dataset.category);
      renderProducts(button.dataset.category);
    });
  });
}

function renderProducts(categoryId = "todos") {
  const allProducts = menuProducts();
  const products = categoryId === "todos" ? allProducts : allProducts.filter((item) => item.categoriaId === categoryId);
  $("#menu-products").innerHTML = products.map((item) => `
    <article class="product-card ${item.destaque ? "is-featured" : ""}">
      ${item.fotoUrl ? `<img src="${item.fotoUrl}" alt="${item.nome}">` : `<div class="product-image-fallback">BQ</div>`}
      <div class="product-body">
        ${item.destaque ? "<span class='menu-badge'>Mais pedido</span>" : ""}
        <strong>${item.nome}</strong>
        <p>${item.descricao || ""}</p>
        <strong>${productPriceLabel(item)}</strong>
      </div>
      <button class="menu-add-button" data-add="${item.id}" aria-label="Adicionar ${escapeHtml(item.nome)}">+</button>
    </article>
  `).join("") || "<p>Nenhum produto disponível nesta categoria.</p>";
  document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
}

function virtualCategories() {
  const categories = [];
  if (moduleFlavors("pizza").length) categories.push({ id: "__pizza", nome: "Pizzas" });
  if (moduleFlavors("porcao").length) categories.push({ id: "__porcao", nome: "Porções" });
  return categories;
}

function menuProducts() {
  const virtual = [];
  const pizzaFlavors = moduleFlavors("pizza");
  if (pizzaFlavors.length) {
    virtual.push({
      id: "__pizza_builder",
      nome: "Monte sua pizza",
      descricao: "Escolha tamanho, sabor, borda e adicionais.",
      categoriaId: "__pizza",
      tipoProduto: "sabores",
      moduleType: "pizza",
      generatedModule: "pizza",
      maxSabores: state.settings.pizzaMeioP || state.settings.pizzaMeioG ? 2 : 1,
      regraPreco: "maior_valor",
      pizzaMode: true,
      pizzaTamanhos: moduleSizes("pizza"),
      disponivel: true
    });
    virtual.push(...pizzaFlavors.map((flavor) => moduleFlavorProduct(flavor, "pizza")));
  }
  const portionFlavors = moduleFlavors("porcao");
  if (portionFlavors.length) {
    virtual.push({
      id: "__portion_builder",
      nome: "Monte sua porção",
      descricao: "Escolha tamanho, opção e adicionais.",
      categoriaId: "__porcao",
      tipoProduto: "sabores",
      moduleType: "porcao",
      generatedModule: "porcao",
      maxSabores: state.settings.porcaoMeioP || state.settings.porcaoMeioG ? 2 : 1,
      regraPreco: "maior_valor",
      pizzaMode: true,
      pizzaTamanhos: moduleSizes("porcao"),
      disponivel: true
    });
    virtual.push(...portionFlavors.map((flavor) => moduleFlavorProduct(flavor, "porcao")));
  }
  return [...virtual, ...publicSimpleProducts()];
}

function moduleFlavorProduct(flavor, type) {
  return {
    id: `__${type}_flavor_${flavor.id}`,
    nome: flavor.nome || (type === "pizza" ? "Pizza" : "Porção"),
    descricao: flavor.descricao || (type === "pizza" ? "Escolha o tamanho da pizza." : "Escolha o tamanho da porção."),
    fotoUrl: flavor.fotoUrl || "",
    categoriaId: type === "pizza" ? "__pizza" : "__porcao",
    tipoProduto: "individual_module",
    moduleType: type,
    generatedModule: type,
    sourceFlavorId: flavor.id,
    sourceFlavor: flavor,
    regraPreco: "maior_valor",
    pizzaMode: true,
    pizzaTamanhos: moduleSizes(type),
    disponivel: true
  };
}

function moduleFlavors(type) {
  return state.flavors.filter((item) => (item.tipo === type || item.moduleType === type) && item.disponivel !== false);
}

function publicSimpleProducts() {
  return state.products.filter((item) => item.moduleType === "simples" && item.disponivel !== false);
}

function publicCategories() {
  const categoryIds = new Set(publicSimpleProducts().map((item) => item.categoriaId).filter(Boolean));
  return state.categories.filter((item) => categoryIds.has(item.id));
}

function moduleSizes(type) {
  const sizes = [];
  const hasP = moduleFlavors(type).some((item) => Number(item.valorP ?? item.precoP ?? item.precosPorTamanho?.P ?? 0) > 0);
  const hasG = moduleFlavors(type).some((item) => Number(item.valorG ?? item.precoG ?? item.precosPorTamanho?.G ?? 0) > 0);
  if (hasP) sizes.push({ nome: "P", preco: 0 });
  if (hasG) sizes.push({ nome: "G", preco: 0 });
  return sizes.length ? sizes : [{ nome: "G", preco: 0 }];
}

function addToCart(productId) {
  const product = menuProducts().find((item) => item.id === productId);
  if (!product) return;
  if (productNeedsBuilder(product)) {
    openProductBuilder(product);
    return;
  }
  const cartItem = buildCartItem(product, [], [], "");
  const existing = state.cart.find((item) => item.signature === cartItem.signature);
  if (existing) existing.quantidade += 1;
  else state.cart.push(cartItem);
  renderCart();
}

function renderCart() {
  $("#cart-items").innerHTML = state.cart.map((item, index) => `
    <div class="cart-line">
      <div>
        <strong>${item.quantidade}x ${item.nome}</strong>
        ${item.tamanho ? `<small>Tamanho: ${item.tamanho.nome}</small>` : ""}
        ${item.sabores?.length ? `<small>Sabores: ${item.sabores.map((flavor) => flavor.nome).join(", ")}</small>` : ""}
        ${item.bordas?.length ? `<small>Borda: ${item.bordas.map((addon) => addon.nome).join(", ")}</small>` : ""}
        ${item.adicionais?.length ? `<small>Adicionais: ${item.adicionais.map((addon) => addon.nome).join(", ")}</small>` : ""}
        <small>${item.observacao || ""}</small>
      </div>
      <div><strong>${money(item.preco * item.quantidade)}</strong><button class="btn btn-small" data-remove="${index}">Remover</button></div>
    </div>
  `).join("") || "<p>Seu carrinho está vazio.</p>";
  $("#cart-total").textContent = money(cartSubtotal());
  document.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
    state.cart.splice(Number(button.dataset.remove), 1);
    renderCart();
  }));
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.preco * item.quantidade, 0);
}

function productNeedsBuilder(product) {
  return product.pizzaMode || product.tipoProduto === "sabores" || product.tipoProduto === "individual_module" || availableAddons(product).length > 0 || product.permiteObservacoes !== false;
}

function productPriceLabel(product) {
  if (product.tipoProduto === "individual_module") {
    const prices = flavorPriceList(product.sourceFlavor).filter((value) => value > 0);
    if (prices.length) return `A partir de ${money(Math.min(...prices))}`;
  }
  if (product.tipoProduto === "sabores") {
    const flavors = productFlavors(product);
    const prices = flavors.flatMap((item) => flavorPriceList(item)).filter((value) => value > 0);
    if (prices.length) return `A partir de ${money(Math.min(...prices))}`;
  }
  return money(product.preco);
}

function flavorPriceList(flavor) {
  if (flavor?.precosPorTamanho && typeof flavor.precosPorTamanho === "object") {
    return Object.values(flavor.precosPorTamanho).map(Number);
  }
  if (flavor?.valorP !== undefined || flavor?.valorG !== undefined || flavor?.precoP !== undefined || flavor?.precoG !== undefined) {
    return [Number(flavor.valorP ?? flavor.precoP ?? 0), Number(flavor.valorG ?? flavor.precoG ?? 0)];
  }
  return [Number(flavor?.preco || 0)];
}

function pizzaSizes(product) {
  if (!Array.isArray(product.pizzaTamanhos)) return [];
  return product.pizzaTamanhos
    .map((item) => ({ nome: item.nome || "", preco: Number(item.preco || 0) }))
    .filter((item) => item.nome);
}

function selectedFlavorLimit(product) {
  if (product.generatedModule === "pizza") {
    const size = state.builderPizzaSize?.nome;
    if (size === "P") return state.settings.pizzaMeioP ? 2 : 1;
    if (size === "G") return state.settings.pizzaMeioG ? 2 : 1;
  }
  if (product.generatedModule === "porcao") {
    const size = state.builderPizzaSize?.nome;
    if (size === "P") return state.settings.porcaoMeioP ? 2 : 1;
    if (size === "G") return state.settings.porcaoMeioG ? 2 : 1;
  }
  if (product.pizzaMode) return Math.max(1, Number(state.builderFlavorMode || 1));
  return Math.max(1, Number(product.maxSabores || 1));
}

function productFlavors(product) {
  if (product.sourceFlavorId) {
    const flavor = state.flavors.find((item) => item.id === product.sourceFlavorId) || product.sourceFlavor;
    return flavor ? [flavor] : [];
  }
  if (product.generatedModule) return moduleFlavors(product.generatedModule);
  return state.flavors.filter((item) => item.categoriaId === product.categoriaId);
}

function flavorPriceForSelection(flavor) {
  const sizeName = state.builderPizzaSize?.nome;
  if (sizeName && flavor?.precosPorTamanho && Object.prototype.hasOwnProperty.call(flavor.precosPorTamanho, sizeName)) {
    return Number(flavor.precosPorTamanho[sizeName] || 0);
  }
  if (sizeName === "P") return Number(flavor.valorP ?? flavor.precoP ?? flavor.preco ?? 0);
  if (sizeName === "G") return Number(flavor.valorG ?? flavor.precoG ?? flavor.preco ?? 0);
  return Number(flavor.preco || 0);
}

function flavorAvailableForSelection(flavor) {
  const sizeName = state.builderPizzaSize?.nome;
  if (sizeName === "P" && Number(flavor.valorP ?? flavor.precoP ?? 0) > 0) return true;
  if (sizeName === "G" && Number(flavor.valorG ?? flavor.precoG ?? 0) > 0) return true;
  if (!sizeName || !flavor?.precosPorTamanho || !Object.keys(flavor.precosPorTamanho).length) return true;
  return Object.prototype.hasOwnProperty.call(flavor.precosPorTamanho, sizeName);
}

function availableAddons(product) {
  return state.addons.filter((addon) => {
    if (addon.disponivel === false) return false;
    if (product.generatedModule === "pizza" && addon.tipoAdicional === "borda") return true;
    if (addon.aplicarPor === "categoria") return addonCategoryIds(addon).includes(product.categoriaId);
    if (Array.isArray(addon.modulos) && addon.modulos.length) {
      const moduleName = product.generatedModule || product.moduleType;
      return addon.modulos.includes(moduleName);
    }
    if (product.generatedModule && addon.tipoAdicional !== "borda") return ["todos", product.generatedModule].includes(addon.aplicarEm || "todos");
    if (product.moduleType && addon.tipoAdicional !== "borda") return ["todos", product.moduleType].includes(addon.aplicarEm || "todos");
    if (addon.aplicarEm === "categoria") return addonCategoryIds(addon).includes(product.categoriaId);
    if (addon.aplicarEm === "produto") return addon.produtoId === product.id;
    return addon.aplicarEm === "todos" || !addon.aplicarEm;
  });
}

function addonCategoryIds(addon) {
  if (Array.isArray(addon.categoriaIds)) return addon.categoriaIds.filter(Boolean);
  return addon.categoriaId ? [addon.categoriaId] : [];
}

function openProductBuilder(product) {
  state.buildingProduct = product;
  state.builderFlavorMode = product.pizzaMode ? 1 : Math.max(1, Number(product.maxSabores || 1));
  state.builderPizzaSize = pizzaSizes(product)[0] || null;
  const flavors = productFlavors(product);
  const addons = availableAddons(product);
  const crusts = addons.filter((addon) => addon.tipoAdicional === "borda");
  const extras = addons.filter((addon) => addon.tipoAdicional !== "borda");
  $("#builder-title").textContent = product.generatedModule === "porcao" ? "Monte a sua porção" : product.pizzaMode ? "Monte a sua pizza" : product.nome;
  $("#builder-subtitle").textContent = builderSubtitle(product, flavors, addons);
  $("#builder-message").textContent = "";
  $("#product-builder-form").reset();
  $("#builder-body").innerHTML = `
    ${product.pizzaMode ? renderPizzaBuilderTop(product) : ""}
    ${product.tipoProduto === "sabores" ? renderFlavorPicker(product, flavors) : ""}
    ${crusts.length ? renderAddonPicker(crusts, "Bordas") : ""}
    ${extras.length ? renderAddonPicker(extras, "Adicionais") : ""}
  `;
  document.querySelectorAll("[data-builder-size]").forEach((input) => {
    input.addEventListener("change", () => {
      state.builderPizzaSize = pizzaSizes(product).find((item) => item.nome === input.value) || pizzaSizes(product)[0] || null;
      document.querySelectorAll("[data-builder-flavor]").forEach((flavorInput) => {
        const flavor = state.flavors.find((item) => item.id === flavorInput.value);
        if (flavor && !flavorAvailableForSelection(flavor)) flavorInput.checked = false;
      });
      enforceFlavorLimit(product);
      updateBuilderSelectionState(product);
      updateBuilderTotal();
    });
  });
  document.querySelectorAll("[data-flavor-mode]").forEach((input) => {
    input.addEventListener("change", () => {
      state.builderFlavorMode = Number(input.value || 1);
      enforceFlavorLimit(product);
      updateBuilderTotal();
      updateBuilderSelectionState(product);
    });
  });
  document.querySelectorAll("[data-builder-option]").forEach((input) => {
    input.addEventListener("change", () => {
      enforceFlavorLimit(product);
      updateBuilderTotal();
      updateBuilderSelectionState(product);
    });
  });
  updateBuilderTotal();
  updateBuilderSelectionState(product);
  $("#product-dialog").showModal();
}

function builderSubtitle(product, flavors, addons) {
  const parts = [];
  if (product.tipoProduto === "individual_module") {
    parts.push(product.generatedModule === "porcao" ? "Escolha o tamanho da porção" : "Escolha o tamanho da pizza");
    if (addons.length) parts.push("Adicionais opcionais");
    return parts.join(" · ");
  }
  if (product.generatedModule === "porcao") {
    parts.push("Escolha tamanho, opção e adicionais");
    return parts.join(" · ");
  }
  if (product.pizzaMode) {
    parts.push("Escolha tamanho, quantidade de sabores e borda");
    return parts.join(" · ");
  }
  if (product.tipoProduto === "sabores") {
    parts.push(`Escolha até ${Math.max(1, Number(product.maxSabores || 1))} sabor(es)`);
    parts.push(priceRuleLabel(product.regraPreco));
  }
  if (addons.length) parts.push("Adicionais opcionais");
  return parts.join(" · ");
}

function renderPizzaBuilderTop(product) {
  const sizes = pizzaSizes(product);
  const max = Math.max(1, Number(product.maxSabores || 2));
  const showSizePrices = !productFlavors(product).some((flavor) => Number(flavor.preco || 0) > 0);
  const isPortion = product.generatedModule === "porcao";
  const isIndividual = product.tipoProduto === "individual_module";
  return `
    <section class="pizza-builder-intro">
      <strong>${escapeHtml(product.nome)}</strong>
      <span>${isPortion ? "Escolha o tamanho e a porção." : showSizePrices ? "Escolha o tamanho e os sabores." : "Escolha o tamanho. O preço será definido pelos sabores."}</span>
    </section>
    ${sizes.length ? `
      <section class="builder-section">
        <div class="builder-section-heading"><strong>Tamanho</strong><span>Obrigatório</span></div>
        <div class="segmented-options">
          ${sizes.map((size, index) => `
            <label class="segment-card">
              <input data-builder-size name="pizzaSize" value="${escapeHtml(size.nome)}" type="radio" ${index === 0 ? "checked" : ""}>
              <span>${escapeHtml(size.nome)}</span>
              ${showSizePrices ? `<small>${money(size.preco)}</small>` : ""}
            </label>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${isIndividual ? "" : `<section class="builder-section">
      <div class="builder-section-heading"><strong>${isPortion ? "Quantidade de opções" : "Quantidade de sabores"}</strong><span>Obrigatório</span></div>
      <div class="segmented-options">
        <label class="segment-card">
          <input data-flavor-mode name="flavorMode" value="1" type="radio" checked>
          <span>Inteira</span>
        </label>
        ${max > 1 ? `
          <label class="segment-card">
            <input data-flavor-mode name="flavorMode" value="${max}" type="radio">
            <span>${max} ${isPortion ? "opções" : "sabores"}</span>
          </label>
        ` : ""}
      </div>
    </section>`}
  `;
}

function renderFlavorPicker(product, flavors) {
  const max = selectedFlavorLimit(product);
  const isPortion = product.generatedModule === "porcao";
  return `
    <section class="builder-section">
      <div class="builder-section-heading">
        <strong>${isPortion ? "Opções" : "Sabores"}</strong>
        <span id="flavor-counter">0 de ${max}</span>
      </div>
      <p id="builder-flavor-help" class="builder-help">${flavorHelpText(product, max)}</p>
      <div class="option-list">
        ${flavors.map((flavor) => `
          <label class="option-card flavor-option-card">
            <input data-builder-option data-builder-flavor value="${flavor.id}" type="checkbox">
            <span><b>${flavor.nome}</b>${max > 1 ? "<small>Disponível para meio a meio</small>" : `<small>${isPortion ? "Porção inteira" : "Pizza inteira"}</small>`}</span>
            <strong data-flavor-price="${flavor.id}">${money(flavorPriceForSelection(flavor))}</strong>
          </label>
        `).join("") || "<p>Nenhum sabor cadastrado para esta categoria.</p>"}
      </div>
    </section>
  `;
}

function flavorHelpText(product, max) {
  if (product.generatedModule === "porcao") return max > 1 ? `Escolha até ${max} opções. No meio a meio, o maior valor prevalece.` : "Escolha 1 porção.";
  if (product.pizzaMode) return max > 1 ? `Escolha até ${max} sabores. No meio a meio, o maior valor prevalece.` : "Escolha 1 sabor para a pizza inteira.";
  if (product.regraPreco === "maior_valor") return `Para meio a meio, selecione ${max} sabores. O valor da pizza será o maior preço escolhido.`;
  if (product.regraPreco === "media_sabores") return "O sistema soma os sabores escolhidos e divide pela quantidade.";
  if (product.regraPreco === "soma_sabores") return "O sistema soma o valor dos sabores escolhidos.";
  return "O preço base do produto será mantido, independente dos sabores.";
}

function renderAddonPicker(addons, title = "Adicionais") {
  return `
    <section class="builder-section">
      <div class="builder-section-heading"><strong>${title}</strong><span>Opcional</span></div>
      <div class="option-grid">
        ${addons.map((addon) => `
          <label class="option-card">
            <input data-builder-option data-builder-addon value="${addon.id}" type="checkbox">
            <span>${addon.nome}</span>
            <strong>+ ${money(addon.preco)}</strong>
          </label>
        `).join("")}
      </div>
    </section>
  `;
}

function enforceFlavorLimit(product) {
  const max = selectedFlavorLimit(product);
  const checked = Array.from(document.querySelectorAll("[data-builder-flavor]:checked"));
  if (checked.length <= max) return;
  checked.slice(max).forEach((input) => input.checked = false);
  setMessage($("#builder-message"), `Escolha no máximo ${max} sabor(es).`, "error");
}

function selectedBuilderFlavors() {
  return Array.from(document.querySelectorAll("[data-builder-flavor]:checked"))
    .map((input) => state.flavors.find((flavor) => flavor.id === input.value))
    .filter(Boolean);
}

function selectedBuilderAddons() {
  return Array.from(document.querySelectorAll("[data-builder-addon]:checked"))
    .map((input) => state.addons.find((addon) => addon.id === input.value))
    .filter(Boolean);
}

function updateBuilderTotal() {
  if (!state.buildingProduct) return;
  const flavors = selectedBuilderFlavors();
  const addons = selectedBuilderAddons();
  $("#builder-total").textContent = money(calculateConfiguredPrice(state.buildingProduct, flavors, addons));
  renderBuilderSummary(state.buildingProduct, flavors, addons);
}

function updateBuilderSelectionState(product) {
  const max = selectedFlavorLimit(product);
  if (product.generatedModule === "porcao") {
    if (Number(state.builderFlavorMode || 1) > max) state.builderFlavorMode = 1;
    const checkedFlavors = Array.from(document.querySelectorAll("[data-builder-flavor]:checked"));
    if (checkedFlavors.length > max) {
      checkedFlavors.slice(max).forEach((input) => input.checked = false);
    }
    document.querySelectorAll("[data-flavor-mode]").forEach((input) => {
      const disabled = Number(input.value || 1) > max;
      input.disabled = disabled;
      if (disabled && input.checked) {
        input.checked = false;
        const fullMode = document.querySelector("[data-flavor-mode][value='1']");
        if (fullMode) fullMode.checked = true;
      }
      input.closest(".segment-card")?.classList.toggle("is-disabled", disabled);
    });
  }
  const flavors = selectedBuilderFlavors();
  const counter = $("#flavor-counter");
  if (counter) counter.textContent = `${flavors.length} de ${max}`;
  const help = $("#builder-flavor-help");
  if (help) help.textContent = flavorHelpText(product, max);
  document.querySelectorAll("[data-builder-flavor]").forEach((input) => {
    const flavor = state.flavors.find((item) => item.id === input.value);
    const available = !flavor || flavorAvailableForSelection(flavor);
    input.disabled = !available;
    if (!available) input.checked = false;
    const card = input.closest(".option-card");
    card?.classList.toggle("is-selected", input.checked);
    card?.classList.toggle("is-disabled", !available);
    const priceTarget = document.querySelector(`[data-flavor-price="${input.value}"]`);
    if (priceTarget && flavor) priceTarget.textContent = available ? money(flavorPriceForSelection(flavor)) : "Indisponível";
  });
  document.querySelectorAll("[data-builder-addon]").forEach((input) => {
    input.closest(".option-card")?.classList.toggle("is-selected", input.checked);
  });
}

function renderBuilderSummary(product, flavors = [], addons = []) {
  const target = $("#builder-summary");
  if (!target) return;
  const price = calculateConfiguredPrice(product, flavors, addons);
  const itemFlavors = product.tipoProduto === "individual_module" ? productFlavors(product) : flavors;
  const { crusts, extras } = splitSelectedAddons(addons);
  target.innerHTML = `
    <strong>Resumo</strong>
    ${product.pizzaMode && state.builderPizzaSize ? `<span>Tamanho: ${escapeHtml(state.builderPizzaSize.nome)}</span>` : ""}
    <span>${itemFlavors.length ? `Sabores: ${itemFlavors.map((item) => item.nome).join(", ")}` : product.tipoProduto === "sabores" ? "Escolha os sabores" : product.nome}</span>
    ${crusts.length ? `<span>Borda: ${crusts.map((item) => item.nome).join(", ")}</span>` : ""}
    ${extras.length ? `<span>Adicionais: ${extras.map((item) => item.nome).join(", ")}</span>` : ""}
    <b>${money(price)}</b>
  `;
}

function splitSelectedAddons(addons = []) {
  return {
    crusts: addons.filter((item) => item.tipoAdicional === "borda"),
    extras: addons.filter((item) => item.tipoAdicional !== "borda")
  };
}

function cartAddonView(addons = []) {
  return addons.map((item) => ({ id: item.id, nome: item.nome, preco: Number(item.preco || 0) }));
}

function calculateConfiguredPrice(product, flavors = [], addons = []) {
  const addonTotal = addons.reduce((sum, addon) => sum + Number(addon.preco || 0), 0);
  const sizeBase = product.pizzaMode ? Number(state.builderPizzaSize?.preco || 0) : Number(product.preco || 0);
  if (product.tipoProduto === "individual_module") {
    const flavor = productFlavors(product)[0];
    return (flavor ? flavorPriceForSelection(flavor) : sizeBase) + addonTotal;
  }
  if (product.tipoProduto !== "sabores" || !flavors.length) return sizeBase + addonTotal;
  const flavorPrices = flavors.map(flavorPriceForSelection);
  const hasFlavorPrices = flavorPrices.some((value) => value > 0);
  let base = sizeBase;
  if (product.pizzaMode && hasFlavorPrices) base = Math.max(...flavorPrices);
  else if (product.regraPreco === "maior_valor") base = Math.max(sizeBase, ...flavorPrices);
  if (product.regraPreco === "media_sabores") base = flavorPrices.reduce((sum, value) => sum + value, 0) / flavorPrices.length;
  if (product.regraPreco === "soma_sabores") base = flavorPrices.reduce((sum, value) => sum + value, 0);
  return base + addonTotal;
}

function buildCartItem(product, flavors = [], addons = [], observacao = "") {
  const itemFlavors = product.tipoProduto === "individual_module" ? productFlavors(product) : flavors;
  const preco = calculateConfiguredPrice(product, flavors, addons);
  const flavorIds = itemFlavors.map((item) => item.id).sort();
  const addonIds = addons.map((item) => item.id).sort();
  const { crusts, extras } = splitSelectedAddons(addons);
  return {
    id: product.id,
    nome: product.nome,
    preco,
    quantidade: 1,
    observacao,
    tamanho: product.pizzaMode && state.builderPizzaSize ? { nome: state.builderPizzaSize.nome, preco: Number(state.builderPizzaSize.preco || 0) } : null,
    sabores: itemFlavors.map((item) => ({ id: item.id, nome: item.nome, preco: flavorPriceForSelection(item) })),
    bordas: cartAddonView(crusts),
    adicionais: cartAddonView(extras),
    regraPreco: product.regraPreco || "fixo",
    signature: [product.id, state.builderPizzaSize?.nome || "", flavorIds.join(","), addonIds.join(","), observacao].join("|")
  };
}

function priceRuleLabel(rule = "fixo") {
  if (rule === "maior_valor") return "Maior valor prevalece";
  if (rule === "media_sabores") return "Somar e dividir";
  if (rule === "soma_sabores") return "Somar sabores";
  return "Preço base";
}

$("#product-dialog-close")?.addEventListener("click", () => $("#product-dialog").close());

$("#product-builder-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const product = state.buildingProduct;
  if (!product) return;
  const flavors = selectedBuilderFlavors();
  const addons = selectedBuilderAddons();
  if (product.tipoProduto === "sabores" && !flavors.length) {
    setMessage($("#builder-message"), "Escolha pelo menos um sabor.", "error");
    return;
  }
  const observacao = event.currentTarget.elements.observacao.value.trim();
  const cartItem = buildCartItem(product, flavors, addons, observacao);
  const existing = state.cart.find((item) => item.signature === cartItem.signature);
  if (existing) existing.quantidade += 1;
  else state.cart.push(cartItem);
  renderCart();
  $("#product-dialog").close();
});

$("#checkout-open")?.addEventListener("click", () => {
  if (!state.cart.length) {
    alert("Adicione pelo menos um item ao carrinho.");
    return;
  }
  renderDeliveryOptions();
  const form = $("#checkout-form");
  const savedPhone = localStorage.getItem(clientSessionKey());
  if (savedPhone && form?.elements.whatsapp && !form.elements.whatsapp.value) {
    form.elements.whatsapp.value = savedPhone;
    lookupCheckoutClient(savedPhone, { silent: true });
  }
  $("#checkout-dialog").showModal();
});

$("#checkout-close")?.addEventListener("click", () => $("#checkout-dialog").close());

$("#payment-method")?.addEventListener("change", (event) => {
  $("#change-field").classList.toggle("hidden", event.target.value !== "Dinheiro");
});

$("#delivery-type")?.addEventListener("change", updateDeliveryPanel);
$("#checkout-form")?.elements.bairro?.addEventListener("input", updateDeliveryFee);
$("#checkout-form")?.elements.whatsapp?.addEventListener("input", (event) => {
  clearTimeout(checkoutLookupTimer);
  const phone = normalizePhone(event.target.value);
  if (phone.length < 10) {
    setMessage($("#client-lookup-message"), "Digite seu WhatsApp para buscar seu cadastro automaticamente.");
    return;
  }
  checkoutLookupTimer = setTimeout(() => lookupCheckoutClient(phone), 450);
});

$("#client-login-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const whatsapp = normalizePhone(event.currentTarget.elements.whatsapp.value);
  if (!whatsapp) return;
  saveClientSession(whatsapp);
  watchClientOrders(whatsapp);
});

async function lookupCheckoutClient(whatsappValue, options = {}) {
  const form = $("#checkout-form");
  const whatsapp = normalizePhone(whatsappValue || form.elements.whatsapp.value);
  if (!whatsapp) return;
  setMessage($("#client-lookup-message"), "Buscando cadastro...");
  const client = await getClientByWhatsApp(state.estabelecimentoId, whatsapp);
  if (!client) {
    if (!options.silent) setMessage($("#client-lookup-message"), "Cliente novo. Complete os dados para finalizar.");
    return;
  }
  ["nome", "cidade", "endereco", "numero", "complemento", "bairro", "referencia"].forEach((key) => {
    form.elements[key].value = client[key] || "";
  });
  updateDeliveryFee();
  saveClientSession(whatsapp);
  setMessage($("#client-lookup-message"), "Cadastro encontrado. Dados preenchidos automaticamente.");
}

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
  saveClientSession(cleanPhone);
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
    status: "Aguardando aprovação",
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
  const items = order.itens.map((item) => {
    const details = [
      item.tamanho ? `  Tamanho: ${item.tamanho.nome}` : "",
      item.sabores?.length ? `  Sabores: ${item.sabores.map((flavor) => flavor.nome).join(", ")}` : "",
      item.bordas?.length ? `  Borda: ${item.bordas.map((addon) => addon.nome).join(", ")}` : "",
      item.adicionais?.length ? `  Adicionais: ${item.adicionais.map((addon) => addon.nome).join(", ")}` : "",
      item.observacao ? `  Obs: ${item.observacao}` : ""
    ].filter(Boolean).join("\n");
    return `- ${item.quantidade}x ${item.nome} (${money(item.preco * item.quantidade)})${details ? `\n${details}` : ""}`;
  }).join("\n");
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
    order.observacoes ? `Observações: ${order.observacoes}` : "",
    `Subtotal: ${money(order.subtotal)}`,
    order.taxaEntrega ? `Taxa de entrega: ${money(order.taxaEntrega)}${order.regraTaxaEntrega ? ` - ${order.regraTaxaEntrega}` : ""}` : "",
    order.taxaConfigurada ? `Taxa de pagamento: ${money(order.taxaConfigurada)}` : "",
    `Total: ${money(order.totalFinal)}`
  ].filter(Boolean).join("\n");
}

function restoreClientSession() {
  const savedPhone = localStorage.getItem(clientSessionKey());
  const form = $("#client-login-form");
  if (savedPhone && form?.elements.whatsapp) {
    form.elements.whatsapp.value = savedPhone;
    watchClientOrders(savedPhone);
  } else {
    renderClientOrders();
  }
}

function saveClientSession(whatsapp) {
  const cleanPhone = normalizePhone(whatsapp);
  if (!cleanPhone) return;
  localStorage.setItem(clientSessionKey(), cleanPhone);
}

function clientSessionKey() {
  return `bqClientPhone:${state.estabelecimentoId}`;
}

function watchClientOrders(whatsapp) {
  const cleanPhone = normalizePhone(whatsapp);
  if (!cleanPhone) return;
  if (state.clientUnsubscribe) state.clientUnsubscribe();
  const ordersQuery = query(
    collection(db, `estabelecimentos/${state.estabelecimentoId}/pedidos`),
    where("clienteId", "==", cleanPhone)
  );
  state.clientUnsubscribe = onSnapshot(ordersQuery, (snap) => {
    state.clientOrders = snap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => timestampMillis(b.criadoEm) - timestampMillis(a.criadoEm));
    renderClientOrders();
  }, (error) => {
    console.error("Não foi possível acompanhar pedidos:", error);
    $("#client-orders-list").innerHTML = "<p>Não foi possível carregar seus pedidos agora.</p>";
  });
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis();
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function renderClientOrders() {
  const target = $("#client-orders-list");
  if (!target) return;
  if (!state.clientOrders.length) {
    target.innerHTML = "<p>Nenhum pedido encontrado para este WhatsApp.</p>";
    return;
  }
  const activeOrders = state.clientOrders.filter((order) => !isFinalOrder(order)).slice(0, 4);
  const historyOrders = state.clientOrders.filter(isFinalOrder).slice(0, 5);
  target.innerHTML = `
    ${activeOrders.length ? activeOrders.map(renderClientOrderCard).join("") : "<p>Nenhum pedido em andamento.</p>"}
    ${historyOrders.length ? `
      <details class="client-history">
        <summary>Histórico (${historyOrders.length})</summary>
        ${historyOrders.map(renderClientOrderCard).join("")}
      </details>
    ` : ""}
  `;
}

function renderClientOrderCard(order) {
  return `
    <article class="client-order-card ${isFinalOrder(order) ? "is-history" : ""}">
      <div>
        <strong>Pedido ${escapeHtml(order.codigo || order.numeroPedido || order.id)}</strong>
        <span>${escapeHtml(order.status || "Aguardando aprovação")}</span>
      </div>
      ${renderCurrentStatus(order.status)}
      <small>${escapeHtml(order.tipoEntrega || "")} - ${money(order.totalFinal)}</small>
      <a class="btn btn-small" href="pedido.html?estabelecimento=${state.estabelecimentoId}&pedido=${order.id}">Ver detalhes</a>
    </article>
  `;
}

function renderCurrentStatus(status = "") {
  const label = status || "Aguardando aprovação";
  const canceled = normalizeStatus(label) === "cancelado";
  return `<div class="current-status ${canceled ? "is-canceled" : ""}">${escapeHtml(label)}</div>`;
}

function isFinalOrder(order) {
  return ["entregue", "cancelado"].includes(normalizeStatus(order.status));
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

function renderNeighborhoodOptions() {
  const list = $("#delivery-neighborhoods");
  if (!list) return;
  const specialFees = parseAreaFees(state.settings.entregaBairrosTaxas);
  const blockedAreas = parseBlockedAreasWithLabel(state.settings.entregaBairrosBloqueados);
  const names = [
    ...Object.values(specialFees).map((item) => item.label),
    ...blockedAreas.map((item) => item.label)
  ].filter(Boolean);
  const uniqueNames = Array.from(new Set(names));
  list.innerHTML = uniqueNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
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
    state.deliveryRule = `Bairro não atendido: ${bairro}`;
    setMessage($("#delivery-fee-message"), "Este bairro não está na área de entrega.", "error");
    return false;
  }
  const specialFees = parseAreaFees(state.settings.entregaBairrosTaxas);
  const matchedKey = findAreaKey(specialFees, normalizedBairro);
  const hasSpecialFee = Boolean(matchedKey);
  const fee = hasSpecialFee ? specialFees[matchedKey].valor : configNumber(state.settings.entregaTaxaPadrao);
  state.deliveryFee = Math.max(0, fee);
  state.deliveryRule = hasSpecialFee ? `Taxa especial: ${specialFees[matchedKey].label}` : "Taxa padrão";
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
      if (normalizedName) acc[normalizedName] = { label: name.trim(), valor: configNumber(value) };
      return acc;
    }, {});
}

function parseBlockedAreas(text = "") {
  return parseBlockedAreasWithLabel(text).map((item) => item.key);
}

function parseBlockedAreasWithLabel(text = "") {
  return String(text || "").split(/[\n,;]/)
    .map((item) => ({ key: normalizeAreaName(item), label: item.trim() }))
    .filter((item) => item.key);
}

function findAreaKey(areaMap, inputKey) {
  const keys = Object.keys(areaMap);
  return keys.find((key) => key === inputKey)
    || keys.find((key) => key.includes(inputKey) || inputKey.includes(key))
    || "";
}

function normalizeAreaName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\bjd\b/g, "jardim");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
