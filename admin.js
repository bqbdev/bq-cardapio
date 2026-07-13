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
  query,
  orderBy,
  sendPasswordResetEmail,
  serverTimestamp
} from "./firebase.js";
import {
  escapeHtml,
  formToObject,
  fromDateInput,
  money,
  normalizePhone,
  planMonths,
  setMessage,
  toBrazilDate,
  toDateInput,
  whatsappLink
} from "./utils.js";

const state = {
  businesses: [],
  requests: [],
  clients: [],
  adminPeriod: "30",
  adminStartDate: "",
  adminEndDate: "",
  clientSearch: "",
  clientBusinessFilter: "all"
};

const $ = (selector) => document.querySelector(selector);
const adminViews = ["dashboard", "solicitacoes", "estabelecimentos", "clientes", "vencimentos"];

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      location.replace("login.html");
      return;
    }
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (!adminSnap.exists()) {
      await signOut(auth);
      location.replace("login.html");
      return;
    }
    $("#admin-user").textContent = user.email || "Admin";
    bindAdminControls();
    await loadAdminData();
    showAdminView(currentView());
    document.body.classList.remove("protected-loading");
  } catch (error) {
    console.error("Falha ao verificar admin:", error);
    await signOut(auth);
    location.replace("login.html");
  }
});

function bindAdminControls() {
  $("#logout-btn")?.addEventListener("click", async () => {
    await signOut(auth);
    location.replace("login.html");
  });
  $("#refresh-admin")?.addEventListener("click", loadAdminData);
  $("#close-editor")?.addEventListener("click", closeEditor);
  $("#admin-period")?.addEventListener("change", (event) => {
    state.adminPeriod = event.target.value;
    toggleCustomPeriod();
    renderMetrics();
    renderAdminInsights();
  });
  $("#admin-start-date")?.addEventListener("change", (event) => {
    state.adminStartDate = event.target.value;
    renderMetrics();
    renderAdminInsights();
  });
  $("#admin-end-date")?.addEventListener("change", (event) => {
    state.adminEndDate = event.target.value;
    renderMetrics();
    renderAdminInsights();
  });
  $("#client-search")?.addEventListener("input", (event) => {
    state.clientSearch = event.target.value;
    renderClients();
  });
  $("#client-business-filter")?.addEventListener("change", (event) => {
    state.clientBusinessFilter = event.target.value;
    renderClients();
  });
  $("#export-clients")?.addEventListener("click", exportClientsCsv);
  $("#business-form")?.addEventListener("submit", saveBusiness);
  document.querySelectorAll("[data-admin-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const view = link.dataset.adminView;
      history.replaceState(null, "", `#${view}`);
      showAdminView(view);
    });
  });
  toggleCustomPeriod();
}

async function loadAdminData() {
  try {
    const [businessSnap, requestSnap] = await Promise.all([
      getDocs(query(collection(db, "estabelecimentos"), orderBy("dataCriacao", "desc"))),
      getDocs(collection(db, "solicitacoes_estabelecimentos"))
    ]);
    state.businesses = businessSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.requests = requestSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => String(item.status || "").toLowerCase() === "pendente")
      .sort((a, b) => dateMillis(b.dataCadastro) - dateMillis(a.dataCadastro));
    state.clients = await loadAllClients(state.businesses);
    renderMetrics();
    renderAdminInsights();
    renderRequests();
    renderBusinesses();
    renderClientBusinessFilter();
    renderClients();
    renderDueDates();
    updateNavigationBadges();
  } catch (error) {
    console.error("Erro ao carregar dados do admin:", error);
    $("#requests-list").innerHTML = `<p class="form-message error">Não foi possível carregar as solicitações: ${escapeHtml(error.message)}</p>`;
    $("#business-table").innerHTML = "<tr><td colspan='6'>Não foi possível carregar os estabelecimentos.</td></tr>";
  }
}

async function loadAllClients(businesses) {
  const groups = await Promise.all(businesses.map(async (business) => {
    try {
      const snap = await getDocs(collection(db, `estabelecimentos/${business.id}/clientes`));
      return snap.docs.map((item) => ({
        id: item.id,
        estabelecimentoId: business.id,
        estabelecimentoNome: business.nomeEstabelecimento || business.nomePublico || "",
        estabelecimentoCidade: business.cidade || "",
        ...item.data()
      }));
    } catch (error) {
      console.warn(`Não foi possível carregar clientes de ${business.nomeEstabelecimento || business.id}:`, error);
      return [];
    }
  }));
  return groups.flat().sort((a, b) => dateMillis(clientLastDate(b)) - dateMillis(clientLastDate(a)));
}

function dateMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function renderMetrics() {
  const total = state.businesses.length;
  const today = todayStartMillis();
  const activeBusinesses = state.businesses.filter((item) => item.status === "ativo");
  const blocked = state.businesses.filter((item) => item.status === "bloqueado").length;
  const overdueBusinesses = state.businesses.filter((item) => item.status === "vencido" || isOverdue(item.proximoVencimento, today));
  const monthlyRevenue = activeBusinesses.reduce((sum, item) => sum + monthlyValue(item), 0);
  const riskRevenue = overdueBusinesses.reduce((sum, item) => sum + monthlyValue(item), 0);
  const clientsInPeriod = clientsForPeriod();
  const whatsappClients = state.clients.filter((client) => normalizePhone(client.whatsapp || client.id)).length;

  setText("#metric-total", total);
  setText("#metric-ativos", activeBusinesses.length);
  setText("#metric-bloqueados", blocked);
  setText("#metric-pendentes", state.requests.length);
  setText("#metric-vencidos", overdueBusinesses.length);
  setText("#metric-receita", money(monthlyRevenue));
  setText("#metric-clientes", state.clients.length);
  setText("#metric-whatsapp", whatsappClients);
  setText("#metric-receita-risco", money(riskRevenue));
  setText("#metric-novos-clientes", clientsInPeriod.length);
}

function renderAdminInsights() {
  const clientsInPeriod = clientsForPeriod();
  const totalOrders = state.clients.reduce((sum, client) => sum + clientOrders(client), 0);
  const totalValue = state.clients.reduce((sum, client) => sum + clientValue(client), 0);
  const recurrentClients = state.clients.filter((client) => clientOrders(client) > 1);
  const reactivationClients = state.clients.filter((client) => isReactivationCandidate(client));
  const dueSoon = dueBusinesses(15);
  const segment = topValue(state.businesses.map((item) => item.segmento).filter(Boolean));
  const city = topValue(state.businesses.map((item) => item.cidade).filter(Boolean));
  const plan = topValue(state.businesses.map((item) => item.plano).filter(Boolean));

  setText("#insight-segmento", segment || "-");
  setText("#insight-cidade", city || "-");
  setText("#insight-plano", plan || "-");
  setText("#insight-clientes-recorrentes", recurrentClients.length);
  setText("#insight-clientes-reativar", reactivationClients.length);
  setText("#insight-ticket-clientes", totalOrders ? money(totalValue / totalOrders) : money(0));
  setText("#admin-tip-1", clientsInPeriod.length
    ? `${clientsInPeriod.length} cliente(s) compraram no período selecionado. Use a aba Clientes para filtrar e exportar essa base.`
    : "Nenhum cliente com compra registrada no período selecionado. Vale estimular os estabelecimentos a divulgarem o cardápio.");
  setText("#admin-tip-2", reactivationClients.length
    ? `${reactivationClients.length} cliente(s) estão sem compra há mais de 45 dias e podem receber uma campanha de retorno.`
    : "A base não tem clientes claros para reativação no momento.");
  setText("#admin-tip-3", dueSoon.length
    ? `${dueSoon.length} estabelecimento(s) vencem nos próximos 15 dias. Priorize contato antes do bloqueio.`
    : "Nenhum vencimento crítico nos próximos 15 dias.");
}

function renderRequests() {
  $("#requests-count").textContent = state.requests.length;
  $("#requests-list").innerHTML = state.requests.map((item) => `
    <article class="list-item">
      <strong>${escapeHtml(item.nomeEstabelecimento || "")}</strong>
      <span>${escapeHtml(item.responsavel || "")} - ${escapeHtml(item.whatsapp || "")} - ${escapeHtml(item.cidade || "")}</span>
      <small>${escapeHtml(item.segmento || "")} ${item.email ? `- ${escapeHtml(item.email)}` : ""}</small>
      <div class="item-actions">
        <button class="btn btn-small btn-primary" data-approve="${item.id}">Aprovar</button>
        <button class="btn btn-small" data-reject="${item.id}">Recusar</button>
      </div>
    </article>
  `).join("") || "<p>Nenhuma solicitação pendente.</p>";
  document.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => approveRequest(button.dataset.approve)));
  document.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => rejectRequest(button.dataset.reject)));
}

function updateNavigationBadges() {
  const badge = $("#requests-nav-badge");
  if (!badge) return;
  badge.textContent = state.requests.length;
  badge.classList.toggle("hidden", state.requests.length === 0);
}

function renderDueDates() {
  const due = dueBusinesses(15);
  $("#due-count").textContent = due.length;
  $("#due-list").innerHTML = due.map((item) => `
    <article class="list-item">
      <strong>${escapeHtml(item.nomeEstabelecimento || "")}</strong>
      <span>Status: ${escapeHtml(item.status || "-")} - Plano: ${escapeHtml(item.plano || "-")}</span>
      <small>Vencimento: ${toBrazilDate(item.proximoVencimento) || "-"} - Mensalidade: ${money(item.valorMensalidade || 0)}</small>
      <div class="item-actions">
        <button class="btn btn-small" data-edit="${item.id}" type="button">Editar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="vencido" type="button">Marcar vencido</button>
      </div>
    </article>
  `).join("") || "<p>Nenhum vencimento nos próximos 15 dias.</p>";
  $("#due-list").querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  $("#due-list").querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.status, button.dataset.value)));
}

function renderBusinesses() {
  $("#business-table").innerHTML = state.businesses.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.nomeEstabelecimento || "")}</strong><br><small>${escapeHtml(item.responsavel || "")}</small></td>
      <td>${escapeHtml(item.plano || "-")}</td>
      <td><span class="pill">${escapeHtml(item.status || "pendente")}</span></td>
      <td>${toBrazilDate(item.proximoVencimento) || "-"}</td>
      <td>${escapeHtml(item.metodoPagamento || "-")}</td>
      <td class="item-actions">
        <button class="btn btn-small" data-edit="${item.id}">Editar</button>
        ${item.activationToken && !item.uid ? `<button class="btn btn-small btn-primary" data-activation="${item.id}">Mensagem de ativação</button>` : ""}
        <button class="btn btn-small" data-password-reset="${item.id}">Resetar senha</button>
        <button class="btn btn-small" data-access-reset="${item.id}">Redefinir acesso</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="ativo">Ativar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="bloqueado">Bloquear</button>
        <button class="btn btn-small" data-delete-business="${item.id}">Excluir</button>
      </td>
    </tr>
  `).join("") || "<tr><td colspan='6'>Nenhum estabelecimento cadastrado.</td></tr>";
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  document.querySelectorAll("[data-activation]").forEach((button) => button.addEventListener("click", () => sendActivationMessage(button.dataset.activation)));
  document.querySelectorAll("[data-password-reset]").forEach((button) => button.addEventListener("click", () => sendPasswordReset(button.dataset.passwordReset)));
  document.querySelectorAll("[data-access-reset]").forEach((button) => button.addEventListener("click", () => resetBusinessAccess(button.dataset.accessReset)));
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.status, button.dataset.value)));
  document.querySelectorAll("[data-delete-business]").forEach((button) => button.addEventListener("click", () => deleteBusiness(button.dataset.deleteBusiness)));
}

function renderClientBusinessFilter() {
  const select = $("#client-business-filter");
  if (!select) return;
  const selected = state.clientBusinessFilter;
  select.innerHTML = [
    `<option value="all">Todos os estabelecimentos</option>`,
    ...state.businesses.map((business) => `<option value="${business.id}">${escapeHtml(business.nomeEstabelecimento || business.id)}</option>`)
  ].join("");
  select.value = state.businesses.some((business) => business.id === selected) ? selected : "all";
  state.clientBusinessFilter = select.value;
}

function renderClients() {
  const tbody = $("#clients-table");
  if (!tbody) return;
  const clients = filteredClients();
  tbody.innerHTML = clients.map((client) => {
    const phone = normalizePhone(client.whatsapp || client.id);
    const location = [client.bairro, client.cidade || client.estabelecimentoCidade].filter(Boolean).join(" - ");
    const waUrl = phone ? whatsappLink(phone, `Olá, ${client.nome || "tudo bem"}!`) : "";
    return `
      <tr>
        <td><strong>${escapeHtml(client.nome || client.nomeCliente || "Cliente sem nome")}</strong><br><small>${escapeHtml(client.endereco || "")}</small></td>
        <td>${waUrl ? `<a href="${waUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(phone)}</a>` : "-"}</td>
        <td>${escapeHtml(client.estabelecimentoNome || "-")}</td>
        <td>${escapeHtml(location || "-")}</td>
        <td>${clientOrders(client)}</td>
        <td>${money(clientValue(client))}</td>
        <td>${toBrazilDate(clientLastDate(client)) || "-"}</td>
        <td>${marketingTags(client).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join(" ")}</td>
      </tr>
    `;
  }).join("") || "<tr><td colspan='8'>Nenhum cliente encontrado para os filtros atuais.</td></tr>";
}

function filteredClients() {
  const term = normalizeText(state.clientSearch);
  return state.clients.filter((client) => {
    const businessMatch = state.clientBusinessFilter === "all" || client.estabelecimentoId === state.clientBusinessFilter;
    const haystack = normalizeText([
      client.nome,
      client.nomeCliente,
      client.whatsapp,
      client.id,
      client.estabelecimentoNome,
      client.cidade,
      client.bairro,
      client.endereco
    ].filter(Boolean).join(" "));
    return businessMatch && (!term || haystack.includes(term));
  });
}

function exportClientsCsv() {
  const rows = filteredClients();
  const header = ["Cliente", "WhatsApp", "Estabelecimento", "Cidade", "Bairro", "Pedidos", "Total comprado", "Última compra", "Tags"];
  const lines = [
    header,
    ...rows.map((client) => [
      client.nome || client.nomeCliente || "",
      normalizePhone(client.whatsapp || client.id),
      client.estabelecimentoNome || "",
      client.cidade || client.estabelecimentoCidade || "",
      client.bairro || "",
      clientOrders(client),
      clientValue(client).toFixed(2).replace(".", ","),
      toBrazilDate(clientLastDate(client)) || "",
      marketingTags(client).join(", ")
    ])
  ];
  const csv = lines.map((line) => line.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `clientes-bq-menu-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function approveRequest(id) {
  const request = state.requests.find((item) => item.id === id);
  if (!request) return;
  const businessRef = doc(collection(db, "estabelecimentos"));
  const activationToken = generateActivationToken();
  await setDoc(businessRef, {
    nomeEstabelecimento: request.nomeEstabelecimento,
    responsavel: request.responsavel,
    whatsapp: request.whatsapp,
    email: request.email,
    documento: request.documento,
    cidade: request.cidade,
    endereco: request.estabelecimentoEndereco || "",
    numero: request.estabelecimentoNumero || "",
    bairro: request.estabelecimentoBairro || "",
    cep: request.estabelecimentoCep || "",
    complemento: request.estabelecimentoComplemento || "",
    latitude: request.estabelecimentoLatitude || "",
    longitude: request.estabelecimentoLongitude || "",
    segmento: request.segmento,
    plano: "Mensal",
    valorMensalidade: 89.90,
    metodoPagamento: "PIX",
    dataInicio: serverTimestamp(),
    proximoVencimento: null,
    status: "aguardando_ativacao",
    observacoesInternas: request.observacao || "",
    dataCriacao: serverTimestamp(),
    ultimoAcesso: null,
    uid: "",
    activationToken,
    activationTokenConfirm: "",
    dataAtivacao: null,
    slug: businessRef.id
  });
  await updateDoc(doc(db, "solicitacoes_estabelecimentos", id), {
    status: "aprovado",
    estabelecimentoId: businessRef.id,
    dataAprovacao: serverTimestamp()
  });
  await setDoc(doc(db, `estabelecimentos/${businessRef.id}/configuracoes`, "geral"), {
    nomePublico: request.nomeEstabelecimento,
    whatsappPedidos: request.whatsapp,
    cidade: request.cidade,
    estabelecimentoEndereco: request.estabelecimentoEndereco || "",
    estabelecimentoNumero: request.estabelecimentoNumero || "",
    estabelecimentoBairro: request.estabelecimentoBairro || "",
    estabelecimentoCep: request.estabelecimentoCep || "",
    estabelecimentoComplemento: request.estabelecimentoComplemento || "",
    estabelecimentoLatitude: request.estabelecimentoLatitude || "",
    estabelecimentoLongitude: request.estabelecimentoLongitude || "",
    aceitaRetirada: true,
    aceitaEntrega: false,
    aceitaLocal: true,
    entregaTaxaPadrao: 0,
    entregaBairrosTaxas: "",
    entregaBairrosBloqueados: "",
    mensagem: "Bem-vindo ao nosso cardápio digital.",
    logoUrl: ""
  });
  await setDoc(doc(db, `estabelecimentos/${businessRef.id}/taxas`, "padrao"), {
    creditoPercentual: 4.99,
    debitoPercentual: 2.49,
    pixPercentual: 0,
    dinheiroPercentual: 0,
    pixFixo: 0,
    dinheiroFixo: 0,
    somarAoPedido: false
  });
  await loadAdminData();
  sendActivationMessage(businessRef.id);
}

async function rejectRequest(id) {
  await updateDoc(doc(db, "solicitacoes_estabelecimentos", id), {
    status: "recusado",
    dataRecusa: serverTimestamp()
  });
  await loadAdminData();
}

async function changeStatus(id, status) {
  await updateDoc(doc(db, "estabelecimentos", id), { status });
  await loadAdminData();
}

async function deleteBusiness(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business) return;
  const name = business.nomeEstabelecimento || business.responsavel || id;
  const confirmed = confirm(`Excluir o estabelecimento "${name}" do painel administrativo?\n\nUse isso quando o usuário já foi apagado no Firebase Authentication ou quando o cadastro não deve mais aparecer no admin.`);
  if (!confirmed) return;
  await deleteDoc(doc(db, "estabelecimentos", id));
  await loadAdminData();
}

function sendActivationMessage(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business?.activationToken) {
    alert("Este estabelecimento ainda não tem link de ativação. Edite ou aprove novamente a solicitação.");
    return;
  }
  const link = activationLink(id, business);
  const message = [
    `Olá, ${business.responsavel || business.nomeEstabelecimento || ""}!`,
    "",
    "Sua conta no BQ Menu foi aprovada.",
    `Para ativar o painel do estabelecimento ${business.nomeEstabelecimento || ""}, acesse o link abaixo e crie sua senha:`,
    "",
    link,
    "",
    "Você precisará digitar a senha duas vezes para confirmar."
  ].join("\n");
  const phone = normalizePhone(business.whatsapp || "");
  const whatsappUrl = whatsappLink(phone, message);
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

async function sendPasswordReset(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business?.email) {
    alert("Este estabelecimento não tem e-mail cadastrado.");
    return;
  }
  await sendPasswordResetEmail(auth, business.email);
  alert(`E-mail de redefinição de senha enviado para ${business.email}.`);
}

async function resetBusinessAccess(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business) return;
  const newEmail = prompt("Informe o novo e-mail de acesso do estabelecimento:", business.email || "");
  if (!newEmail) return;
  const activationToken = generateActivationToken();
  await updateDoc(doc(db, "estabelecimentos", id), {
    email: newEmail.trim().toLowerCase(),
    uid: "",
    status: "aguardando_ativacao",
    activationToken,
    activationTokenConfirm: "",
    ultimoAcesso: null
  });
  await loadAdminData();
  sendActivationMessage(id);
}

function activationLink(id, business) {
  const base = `${location.origin}${location.pathname.replace(/admin\.html$/, "")}ativar.html`;
  const params = new URLSearchParams({
    estabelecimento: id,
    token: business.activationToken,
    email: business.email || "",
    nome: business.nomeEstabelecimento || "estabelecimento",
    plano: business.plano || "Mensal"
  });
  return `${base}?${params.toString()}`;
}

function generateActivationToken() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(36)).join("");
}

function openEditor(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business) return;
  const form = $("#business-form");
  Object.entries({
    id,
    nomeEstabelecimento: business.nomeEstabelecimento,
    responsavel: business.responsavel,
    whatsapp: business.whatsapp,
    email: business.email,
    uid: business.uid,
    documento: business.documento,
    cidade: business.cidade,
    segmento: business.segmento,
    plano: business.plano || "Mensal",
    valorMensalidade: business.valorMensalidade || 89.90,
    metodoPagamento: business.metodoPagamento,
    dataInicio: toDateInput(business.dataInicio),
    proximoVencimento: toDateInput(business.proximoVencimento),
    status: business.status,
    observacoesInternas: business.observacoesInternas
  }).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value || "";
  });
  setMessage(form.querySelector(".form-message"), "");
  $("#business-editor").classList.remove("hidden");
  showAdminView("estabelecimentos");
}

function closeEditor() {
  const form = $("#business-form");
  if (form) form.reset();
  $("#business-editor").classList.add("hidden");
}

async function saveBusiness(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const id = data.id;
  delete data.id;
  await updateDoc(doc(db, "estabelecimentos", id), {
    ...data,
    plano: data.plano || "Mensal",
    valorMensalidade: Number(data.valorMensalidade || 89.90),
    dataInicio: fromDateInput(data.dataInicio),
    proximoVencimento: fromDateInput(data.proximoVencimento)
  });
  setMessage(form.querySelector(".form-message"), "Alterações salvas.");
  closeEditor();
  await loadAdminData();
}

function currentView() {
  const hashView = location.hash.replace("#", "");
  return adminViews.includes(hashView) ? hashView : "dashboard";
}

function showAdminView(view) {
  const safeView = adminViews.includes(view) ? view : "dashboard";
  document.querySelectorAll(".admin-view").forEach((section) => {
    const matchesView = section.dataset.view === safeView;
    const isEditor = section.id === "business-editor";
    section.classList.toggle("hidden", !matchesView || (isEditor && !section.querySelector("[name='id']")?.value));
  });
  document.querySelectorAll("[data-admin-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.adminView === safeView);
  });
}

function toggleCustomPeriod() {
  $("#admin-custom-period")?.classList.toggle("hidden", state.adminPeriod !== "custom");
}

function clientsForPeriod() {
  return state.clients.filter((client) => isInsidePeriod(clientLastDate(client)));
}

function isInsidePeriod(value) {
  if (state.adminPeriod === "all") return true;
  const millis = dateMillis(value);
  if (!millis) return false;
  const range = adminPeriodRange();
  return millis >= range.start && millis <= range.end;
}

function adminPeriodRange() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (state.adminPeriod === "custom") {
    const customStart = state.adminStartDate ? new Date(`${state.adminStartDate}T00:00:00`) : start;
    const customEnd = state.adminEndDate ? new Date(`${state.adminEndDate}T23:59:59`) : end;
    return { start: customStart.getTime(), end: customEnd.getTime() };
  }
  if (state.adminPeriod !== "today") {
    start.setDate(start.getDate() - (Number(state.adminPeriod || 30) - 1));
  }
  return { start: start.getTime(), end: end.getTime() };
}

function dueBusinesses(days = 15) {
  const now = new Date();
  const soon = new Date();
  soon.setDate(now.getDate() + days);
  return state.businesses
    .filter((item) => {
      const millis = dateMillis(item.proximoVencimento);
      return millis && millis <= soon.getTime();
    })
    .sort((a, b) => dateMillis(a.proximoVencimento) - dateMillis(b.proximoVencimento));
}

function todayStartMillis() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function isOverdue(value, today = todayStartMillis()) {
  const millis = dateMillis(value);
  return Boolean(millis && millis < today);
}

function monthlyValue(business) {
  const value = Number(business.valorMensalidade || 0);
  return value / Math.max(planMonths(business.plano || ""), 1);
}

function clientOrders(client) {
  return Number(client.totalCompras || client.totalPedidos || client.pedidos || 0);
}

function clientValue(client) {
  return Number(client.valorTotalComprado || client.valorTotal || client.totalGasto || 0);
}

function clientLastDate(client) {
  return client.ultimaCompra || client.ultimoPedido || client.dataCadastro || client.criadoEm || client.atualizadoEm || null;
}

function isReactivationCandidate(client) {
  const last = dateMillis(clientLastDate(client));
  if (!last) return false;
  const limit = new Date();
  limit.setDate(limit.getDate() - 45);
  return last < limit.getTime();
}

function marketingTags(client) {
  const tags = [];
  if (normalizePhone(client.whatsapp || client.id)) tags.push("WhatsApp");
  if (clientOrders(client) > 1) tags.push("Recorrente");
  if (isReactivationCandidate(client)) tags.push("Reativar");
  if (!tags.length) tags.push("Completar cadastro");
  return tags;
}

function topValue(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function csvCell(value = "") {
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}
