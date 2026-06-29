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

const state = { businessId: "", business: null, categories: [], products: [], orders: [], clients: [], orderSearch: "" };
const $ = (selector) => document.querySelector(selector);

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
  if (!file.type.startsWith("image/")) {
    alert("Selecione uma imagem valida.");
    event.target.value = "";
    return;
  }
  if (file.size > 750 * 1024) {
    alert("Escolha uma imagem menor que 750 KB para salvar em Base64 no Firestore.");
    event.target.value = "";
    return;
  }
  const base64 = await fileToBase64(file);
  const form = $("#product-form");
  form.elements.fotoUrl.value = base64;
  renderPhotoPreview(base64);
});
$("#business-logo-file")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Selecione uma imagem valida.");
    event.target.value = "";
    return;
  }
  if (file.size > 750 * 1024) {
    alert("Escolha uma imagem menor que 750 KB para salvar em Base64 no Firestore.");
    event.target.value = "";
    return;
  }
  const base64 = await fileToBase64(file);
  const form = $("#settings-form");
  form.elements.logoUrl.value = base64;
  renderBusinessLogoPreview(base64);
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
    <div class="list-item">
      <strong>${item.nome} ${item.destaque ? "<span class='pill'>Destaque</span>" : ""}</strong>
      <small>${money(item.preco)} - ${item.disponivel ? "Disponivel" : "Indisponivel"}</small>
      <div class="item-actions">
        <button class="btn btn-small" data-edit-product="${item.id}" type="button">Editar</button>
        <button class="btn btn-small btn-primary" data-highlight-product="${item.id}" type="button">${item.destaque ? "Remover destaque" : "Destacar"}</button>
      </div>
    </div>
  `).join("") || "<p>Nenhum produto cadastrado.</p>";
  document.querySelectorAll("[data-edit-product]").forEach((button) => button.addEventListener("click", () => fillProduct(button.dataset.editProduct)));
  document.querySelectorAll("[data-highlight-product]").forEach((button) => button.addEventListener("click", () => toggleProductHighlight(button.dataset.highlightProduct)));
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
    <article class="list-item"><strong>${item.nome || item.id}</strong><span>${item.whatsapp || item.id}</span><small>${item.totalCompras || 0} compras - ${money(item.valorTotalComprado)}</small></article>
  `).join("") || "<p>Nenhum cliente ainda.</p>";
}

function renderOrders() {
  const orders = filteredOrders();
  $("#orders-list").innerHTML = orders.map((order) => `
    <article class="list-item">
      <strong>Pedido ${order.numeroPedido || order.codigo || order.id} - ${order.clienteNome || ""}</strong>
      <span>${order.status || "Novo"} - ${order.tipoEntrega || ""} - ${money(order.totalFinal)}</span>
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
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
  ["nomePublico", "whatsappPedidos", "logoUrl", "cidade", "mensagem"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = data[key] || state.business[key] || "";
  });
  renderBusinessLogoPreview(form.elements.logoUrl?.value || "");
}

$("#settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await setDoc(doc(db, `estabelecimentos/${state.businessId}/configuracoes`, "geral"), formToObject(event.currentTarget), { merge: true });
  setMessage(null, "Salvo.");
});

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
