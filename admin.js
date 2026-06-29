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
  orderBy,
  sendPasswordResetEmail,
  serverTimestamp
} from "./firebase.js";
import { formToObject, money, fromDateInput, toBrazilDate, toDateInput, setMessage } from "./utils.js";

const state = { businesses: [], requests: [] };
const $ = (selector) => document.querySelector(selector);
const adminViews = ["dashboard", "solicitacoes", "estabelecimentos", "vencimentos"];

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
    await loadAdminData();
    showAdminView(currentView());
    document.body.classList.remove("protected-loading");
  } catch (error) {
    console.error("Falha ao verificar admin:", error);
    await signOut(auth);
    location.replace("login.html");
  }
});

$("#logout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  location.replace("login.html");
});
$("#refresh-admin")?.addEventListener("click", loadAdminData);
$("#close-editor")?.addEventListener("click", closeEditor);
document.querySelectorAll("[data-admin-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const view = link.dataset.adminView;
    history.replaceState(null, "", `#${view}`);
    showAdminView(view);
  });
});

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
    renderMetrics();
    renderRequests();
    renderBusinesses();
    renderDueDates();
    updateNavigationBadges();
  } catch (error) {
    console.error("Erro ao carregar dados do admin:", error);
    $("#requests-list").innerHTML = `<p class="form-message error">Não foi possível carregar as solicitações: ${error.message}</p>`;
    $("#business-table").innerHTML = "<tr><td colspan='6'>Não foi possível carregar os estabelecimentos.</td></tr>";
  }
}

function dateMillis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function renderMetrics() {
  const total = state.businesses.length;
  const count = (status) => state.businesses.filter((item) => item.status === status).length;
  const receita = state.businesses
    .filter((item) => item.status === "ativo")
    .reduce((sum, item) => sum + Number(item.valorMensalidade || 0), 0);
  $("#metric-total").textContent = total;
  $("#metric-ativos").textContent = count("ativo");
  $("#metric-bloqueados").textContent = count("bloqueado");
  $("#metric-pendentes").textContent = state.requests.length;
  $("#metric-vencidos").textContent = count("vencido");
  $("#metric-receita").textContent = money(receita);
}

function renderRequests() {
  $("#requests-count").textContent = state.requests.length;
  $("#requests-list").innerHTML = state.requests.map((item) => `
    <article class="list-item">
      <strong>${item.nomeEstabelecimento || ""}</strong>
      <span>${item.responsavel || ""} - ${item.whatsapp || ""} - ${item.cidade || ""}</span>
      <small>${item.segmento || ""} ${item.email ? `- ${item.email}` : ""}</small>
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
  const now = new Date();
  const soon = new Date();
  soon.setDate(now.getDate() + 15);
  const dueBusinesses = state.businesses
    .filter((item) => {
      const millis = dateMillis(item.proximoVencimento);
      return millis && millis <= soon.getTime();
    })
    .sort((a, b) => dateMillis(a.proximoVencimento) - dateMillis(b.proximoVencimento));
  $("#due-count").textContent = dueBusinesses.length;
  $("#due-list").innerHTML = dueBusinesses.map((item) => `
    <article class="list-item">
      <strong>${item.nomeEstabelecimento || ""}</strong>
      <span>Status: ${item.status || "-"} - Plano: ${item.plano || "-"}</span>
      <small>Vencimento: ${toBrazilDate(item.proximoVencimento) || "-"} - Mensalidade: ${money(item.valorMensalidade || 0)}</small>
      <div class="item-actions">
        <button class="btn btn-small" data-edit="${item.id}" type="button">Editar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="vencido" type="button">Marcar vencido</button>
      </div>
    </article>
  `).join("") || "<p>Nenhum vencimento nos proximos 15 dias.</p>";
  $("#due-list").querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  $("#due-list").querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.status, button.dataset.value)));
}

function renderBusinesses() {
  $("#business-table").innerHTML = state.businesses.map((item) => `
    <tr>
      <td><strong>${item.nomeEstabelecimento || ""}</strong><br><small>${item.responsavel || ""}</small></td>
      <td>${item.plano || "-"}</td>
      <td><span class="pill">${item.status || "pendente"}</span></td>
      <td>${toBrazilDate(item.proximoVencimento) || "-"}</td>
      <td>${item.metodoPagamento || "-"}</td>
      <td class="item-actions">
        <button class="btn btn-small" data-edit="${item.id}">Editar</button>
        ${item.activationToken && !item.uid ? `<button class="btn btn-small btn-primary" data-activation="${item.id}">Mensagem ativacao</button>` : ""}
        <button class="btn btn-small" data-password-reset="${item.id}">Reset senha</button>
        <button class="btn btn-small" data-access-reset="${item.id}">Redefinir acesso</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="ativo">Ativar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="bloqueado">Bloquear</button>
      </td>
    </tr>
  `).join("") || "<tr><td colspan='6'>Nenhum estabelecimento cadastrado.</td></tr>";
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  document.querySelectorAll("[data-activation]").forEach((button) => button.addEventListener("click", () => sendActivationMessage(button.dataset.activation)));
  document.querySelectorAll("[data-password-reset]").forEach((button) => button.addEventListener("click", () => sendPasswordReset(button.dataset.passwordReset)));
  document.querySelectorAll("[data-access-reset]").forEach((button) => button.addEventListener("click", () => resetBusinessAccess(button.dataset.accessReset)));
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.status, button.dataset.value)));
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
    plano: "Essencial",
    valorMensalidade: 49.9,
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

function sendActivationMessage(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business?.activationToken) {
    alert("Este estabelecimento ainda não tem link de ativação. Edite ou aprove novamente a solicitação.");
    return;
  }
  const link = activationLink(id, business);
  const message = [
    `Ola, ${business.responsavel || business.nomeEstabelecimento || ""}!`,
    "",
    `Sua conta no BQ Menu foi aprovada.`,
    `Para ativar o painel do estabelecimento ${business.nomeEstabelecimento || ""}, acesse o link abaixo e crie sua senha:`,
    "",
    link,
    "",
    "Você precisará digitar a senha duas vezes para confirmar."
  ].join("\n");
  const phone = String(business.whatsapp || "").replace(/\D/g, "");
  const whatsappUrl = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

async function sendPasswordReset(id) {
  const business = state.businesses.find((item) => item.id === id);
  if (!business?.email) {
    alert("Este estabelecimento não tem e-mail cadastrado.");
    return;
  }
  await sendPasswordResetEmail(auth, business.email);
  alert(`E-mail de redefinicao de senha enviado para ${business.email}.`);
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
    plano: business.plano || "Essencial"
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
    plano: business.plano,
    valorMensalidade: business.valorMensalidade,
    metodoPagamento: business.metodoPagamento,
    dataInicio: toDateInput(business.dataInicio),
    proximoVencimento: toDateInput(business.proximoVencimento),
    status: business.status,
    observacoesInternas: business.observacoesInternas
  }).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value || "";
  });
  $("#business-editor").classList.remove("hidden");
  showAdminView("estabelecimentos");
}

function closeEditor() {
  const form = $("#business-form");
  if (form) form.reset();
  $("#business-editor").classList.add("hidden");
}

$("#business-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formToObject(form);
  const id = data.id;
  delete data.id;
  await updateDoc(doc(db, "estabelecimentos", id), {
    ...data,
    valorMensalidade: Number(data.valorMensalidade || 0),
    dataInicio: fromDateInput(data.dataInicio),
    proximoVencimento: fromDateInput(data.proximoVencimento)
  });
  setMessage(form.querySelector(".form-message"), "Salvo.");
  closeEditor();
  await loadAdminData();
});

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
