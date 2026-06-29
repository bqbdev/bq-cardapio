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
  serverTimestamp
} from "./firebase.js";
import { formToObject, money, fromDateInput, toDateInput, setMessage } from "./utils.js";

const state = { businesses: [], requests: [] };
const $ = (selector) => document.querySelector(selector);

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
$("#close-editor")?.addEventListener("click", () => $("#business-editor").classList.add("hidden"));

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
  } catch (error) {
    console.error("Erro ao carregar dados do admin:", error);
    $("#requests-list").innerHTML = `<p class="form-message error">Nao foi possivel carregar as solicitacoes: ${error.message}</p>`;
    $("#business-table").innerHTML = "<tr><td colspan='6'>Nao foi possivel carregar os estabelecimentos.</td></tr>";
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
  $("#metric-pendentes").textContent = count("pendente");
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
  `).join("") || "<p>Nenhuma solicitacao pendente.</p>";
  document.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => approveRequest(button.dataset.approve)));
  document.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => rejectRequest(button.dataset.reject)));
}

function renderBusinesses() {
  $("#business-table").innerHTML = state.businesses.map((item) => `
    <tr>
      <td><strong>${item.nomeEstabelecimento || ""}</strong><br><small>${item.responsavel || ""}</small></td>
      <td>${item.plano || "-"}</td>
      <td><span class="pill">${item.status || "pendente"}</span></td>
      <td>${toDateInput(item.proximoVencimento) || "-"}</td>
      <td>${item.metodoPagamento || "-"}</td>
      <td class="item-actions">
        <button class="btn btn-small" data-edit="${item.id}">Editar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="ativo">Ativar</button>
        <button class="btn btn-small" data-status="${item.id}" data-value="bloqueado">Bloquear</button>
      </td>
    </tr>
  `).join("") || "<tr><td colspan='6'>Nenhum estabelecimento cadastrado.</td></tr>";
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.edit)));
  document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.status, button.dataset.value)));
}

async function approveRequest(id) {
  const request = state.requests.find((item) => item.id === id);
  if (!request) return;
  const businessRef = doc(collection(db, "estabelecimentos"));
  await setDoc(businessRef, {
    nomeEstabelecimento: request.nomeEstabelecimento,
    responsavel: request.responsavel,
    whatsapp: request.whatsapp,
    email: request.email,
    documento: request.documento,
    cidade: request.cidade,
    segmento: request.segmento,
    plano: "Essencial",
    valorMensalidade: 49.9,
    metodoPagamento: "PIX",
    dataInicio: serverTimestamp(),
    proximoVencimento: null,
    status: "ativo",
    observacoesInternas: request.observacao || "",
    dataCriacao: serverTimestamp(),
    ultimoAcesso: null,
    uid: "",
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
    mensagem: "Bem-vindo ao nosso cardapio digital.",
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
  $("#business-editor").classList.add("hidden");
  await loadAdminData();
});
