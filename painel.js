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
  query,
  where,
  orderBy,
  serverTimestamp
} from "./firebase.js";
import { addMonths, formToObject, money, numberValue, planMonths, printOrder, setMessage, todayStart, toBrazilDate } from "./utils.js";
import { renderFinanceSummary } from "./financeiro.js";
import { fillCoordinatesFromAddress } from "./geocoding.js";

const state = { businessId: "", business: null, categories: [], products: [], orders: [], clients: [], orderSearch: "" };
const $ = (selector) => document.querySelector(selector);
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
      alert("Acesso temporariamente bloqueado. Fale com a administracao da plataforma.");
      await signOut(auth);
      location.replace("login.html");
      return;
    }
    sessionStorage.setItem("businessId", state.businessId);
    updateDoc(doc(db, "estabelecimentos", state.businessId), { ultimoAcesso: serverTimestamp() }).catch((error) => {
      console.warn("Nao foi possivel atualizar ultimo acesso:", error);
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
});
$("#use-business-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Seu navegador nao permite pegar localizacao.");
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const form = $("#settings-form");
    form.elements.estabelecimentoLatitude.value = position.coords.latitude.toFixed(6);
    form.elements.estabelecimentoLongitude.value = position.coords.longitude.toFixed(6);
  }, () => {
    alert("Nao foi possivel pegar a localizacao. Verifique a permissao do navegador.");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

$("#geocode-business-address")?.addEventListener("click", async () => {
  try {
    await fillCoordinatesFromAddress($("#settings-form"));
    alert("Coordenadas preenchidas pelo endereco.");
  } catch (error) {
    alert(error.message);
  }
});
$("#add-delivery-fee-row")?.addEventListener("click", () => addDeliveryFeeRow());

async function findBusinessForUser(uid) {
  const savedBusinessId = sessionStorage.getItem("businessId");
  if (savedBusinessId) {
    try {
      const savedSnap = await getDoc(doc(db, "estabelecimentos", savedBusinessId));
      if (savedSnap.exists() && savedSnap.data().uid === uid) {
        return { id: savedSnap.id, data: () => savedSnap.data() };
      }
    } catch (error) {
      console.warn("Nao foi possivel carregar estabelecimento salvo:", error);
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
  renderRenewalInfo();
}

function renderRenewalInfo() {
  const plan = state.business.plano || "Essencial";
  const activationDate = state.business.dataAtivacao || state.business.dataInicio || new Date();
  const renewalDate = state.business.proximoVencimento || addMonths(activationDate, planMonths(plan));
  $("#next-renewal").textContent = toBrazilDate(renewalDate) || "--/--/----";
  $("#renewal-plan").textContent = `Plano ${plan}`;
}

async function loadPanelData() {
  await Promise.all([loadCategories(), loadProducts(), loadOrders(), loadClients(), loadSettings(), loadFees()]);
}

async function loadCategories() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/categorias`), orderBy("ordem", "asc")));
  state.categories = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  $("#product-category").innerHTML = state.categories.map((item) => `<option value="${item.id}">${item.nome}</option>`).join("");
  $("#categories-list").innerHTML = state.categories.map((item) => `
    <div class="list-item">
      <strong>${item.nome}</strong><small>${item.ativo ? "Ativo" : "Inativo"} - ordem ${item.ordem || 0}</small>
      <button class="btn btn-small" data-edit-category="${item.id}" type="button">Editar</button>
    </div>
  `).join("") || "<p>Nenhuma categoria cadastrada.</p>";
  document.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => fillCategory(button.dataset.editCategory)));
}

async function loadProducts() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/produtos`), orderBy("nome", "asc")));
  state.products = snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(Boolean(b.destaque)) - Number(Boolean(a.destaque)) || String(a.nome || "").localeCompare(String(b.nome || "")));
  $("#products-list").innerHTML = state.products.map((item) => `
    <div class="list-item product-list-item ${item.disponivel === false ? "is-disabled" : ""}">
      <div class="product-admin-thumb">
        ${item.fotoUrl ? `<img src="${item.fotoUrl}" alt="${item.nome}">` : "<span>Sem foto</span>"}
      </div>
      <div class="product-admin-info">
        <strong>${item.nome} ${item.destaque ? "<span class='pill'>Destaque</span>" : ""}</strong>
        <small>${money(item.preco)} - ${item.disponivel !== false ? "Disponivel" : "Indisponivel"}</small>
      </div>
      <div class="item-actions">
        <button class="btn btn-small" data-edit-product="${item.id}" type="button">Editar</button>
        <button class="btn btn-small ${item.disponivel !== false ? "btn-primary" : ""}" data-toggle-product="${item.id}" type="button">${item.disponivel !== false ? "Disponivel" : "Ativar"}</button>
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

async function loadOrders() {
  const snap = await getDocs(query(collection(db, `estabelecimentos/${state.businessId}/pedidos`), orderBy("criadoEm", "desc")));
  state.orders = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderOrders();
  renderDashboard();
  renderFinanceSummary("#finance-summary", state.orders);
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
  return address || "Endereco ainda nao informado";
}

function renderOrders() {
  const orders = filteredOrders();
  $("#orders-list").innerHTML = orders.map((order) => `
    <article class="list-item">
      <strong>Pedido ${order.numeroPedido || order.codigo || order.id} - ${order.clienteNome || ""}</strong>
      <span>${order.status || "Novo"} - ${order.tipoEntrega || ""} - ${money(order.totalFinal)}</span>
      ${order.taxaEntrega ? `<small>Entrega: ${money(order.taxaEntrega)}${order.regraTaxaEntrega ? ` - ${order.regraTaxaEntrega}` : ""}</small>` : ""}
      <small>Codigo: ${order.codigo || order.id} - WhatsApp: ${order.whatsapp || ""}</small>
      <small>${(order.itens || []).map((item) => `${item.quantidade || 1}x ${item.nome}`).join(", ")}</small>
      <div class="item-actions">
        ${["Aceito", "Em preparo", "Pronto", "Saiu para entrega", "Entregue", "Cancelado"].map((status) => `<button class="btn btn-small" data-order-status="${order.id}" data-status-value="${status}" type="button">${status}</button>`).join("")}
        <button class="btn btn-small" data-print-client="${order.id}" type="button">Imprimir cliente</button>
        <button class="btn btn-small" data-print-kitchen="${order.id}" type="button">Imprimir cozinha</button>
      </div>
    </article>
  `).join("") || "<p>Nenhum pedido encontrado.</p>";
  document.querySelectorAll("[data-order-status]").forEach((button) => button.addEventListener("click", () => updateOrderStatus(button.dataset.orderStatus, button.dataset.statusValue)));
  document.querySelectorAll("[data-print-client]").forEach((button) => button.addEventListener("click", () => printById(button.dataset.printClient, false)));
  document.querySelectorAll("[data-print-kitchen]").forEach((button) => button.addEventListener("click", () => printById(button.dataset.printKitchen, true)));
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
  await loadOrders();
}

function printById(id, kitchen) {
  const order = state.orders.find((item) => item.id === id);
  if (order) printOrder(order, kitchen);
}

$("#category-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const id = data.id || doc(collection(db, "tmp")).id;
  await setDoc(doc(db, `estabelecimentos/${state.businessId}/categorias`, id), {
    nome: data.nome,
    descricao: data.descricao || "",
    ordem: Number(data.ordem || 0),
    ativo: Boolean(data.ativo),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
  form.reset();
  form.elements.ativo.checked = true;
  await loadCategories();
});

$("#product-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const id = data.id || doc(collection(db, "tmp")).id;
  await setDoc(doc(db, `estabelecimentos/${state.businessId}/produtos`, id), {
    nome: data.nome,
    descricao: data.descricao || "",
    categoriaId: data.categoriaId || "",
    preco: numberValue(data.preco),
    fotoUrl: data.fotoUrl || "",
    disponivel: Boolean(data.disponivel),
    destaque: Boolean(data.destaque),
    permiteObservacoes: Boolean(data.permiteObservacoes),
    atualizadoEm: serverTimestamp()
  }, { merge: true });
  form.reset();
  form.elements.disponivel.checked = true;
  form.elements.permiteObservacoes.checked = true;
  renderPhotoPreview("");
  await loadProducts();
});

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

function fillProduct(id) {
  const item = state.products.find((product) => product.id === id);
  const form = $("#product-form");
  if (!item) return;
  ["id", "nome", "descricao", "categoriaId", "preco", "fotoUrl"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = key === "id" ? id : item[key] || "";
  });
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
    alert("Selecione uma imagem valida.");
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
    console.warn("Nao foi possivel compactar a imagem:", error);
    const base64 = await fileToBase64(file);
    if (base64.length > 750 * 1024) {
      alert("Nao foi possivel compactar esta imagem. Escolha uma imagem menor para salvar em Base64.");
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
      reject(new Error("Imagem invalida"));
    };
    image.src = objectUrl;
  });
}

function renderPhotoPreview(src) {
  const preview = $("#product-photo-preview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${src}" alt="Previa da foto do produto">` : "Sem foto selecionada";
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
  renderDeliveryFeeRows(form.elements.entregaBairrosTaxas?.value || "");
}

$("#settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    setFormUpdating(form, true, "Atualizando...");
    syncDeliveryFeeRowsToField();
    await setDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"), formToObject(form), { merge: true });
    setFormUpdating(form, true, "Atualizacoes feitas");
    setTimeout(() => setFormUpdating(form, false), 900);
  } catch (error) {
    setFormUpdating(form, false);
    alert(`Nao foi possivel salvar: ${error.message}`);
  }
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

function renderBusinessLogoPreview(src) {
  const preview = $("#business-logo-preview");
  if (!preview) return;
  preview.innerHTML = src ? `<img src="${src}" alt="Previa do logo do estabelecimento">` : "Sem logo selecionado";
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
  const data = formToObject(event.currentTarget);
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
