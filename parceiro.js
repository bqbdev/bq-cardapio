import {
  db,
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  limit,
  serverTimestamp
} from "./firebase.js";
import { formToObject, money, normalizePhone, setMessage, whatsappLink } from "./utils.js";

const partnerForm = document.querySelector("#partner-form");
const referralForm = document.querySelector("#referral-form");
const partnerPanelForm = document.querySelector("#partner-panel-form");
const partnerMessage = document.querySelector("#partner-message");
const referralMessage = document.querySelector("#referral-message");
const partnerPanelMessage = document.querySelector("#partner-panel-message");
const partnerPanelSummary = document.querySelector("#partner-panel-summary");
const partnerPanelResults = document.querySelector("#partner-panel-results");
const partnerPanelMonth = document.querySelector("#partner-panel-month");
const partnerPanelLinkCard = document.querySelector("#partner-panel-link-card");
const partnerPanelLink = document.querySelector("#partner-panel-link");
const partnerPanelCopyLink = document.querySelector("#partner-panel-copy-link");
const partnerLinkCard = document.querySelector("#partner-link-card");
const partnerGeneratedLink = document.querySelector("#partner-generated-link");
const partnerCopyLink = document.querySelector("#partner-copy-link");
const calculatorRange = document.querySelector("#partner-calculator-range");
const calculatorCustom = document.querySelector("#partner-calculator-custom");
const calculatorCount = document.querySelector("#partner-calculator-count");
const calculatorTotal = document.querySelector("#partner-calculator-total");
const calculatorNote = document.querySelector("#partner-calculator-note");
const partnerPhoneParam = new URLSearchParams(location.search).get("parceiro") || "";
const supportPhone = "19995016307";
let lastPanelPhone = "";
let lastPanelReferrals = [];

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeDocument(value = "") {
  return String(value).replace(/\D/g, "");
}

function safeNumber(value, fallback = 1) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dateMillis(value) {
  if (!value) return 0;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDate(value) {
  const millis = dateMillis(value);
  return millis ? new Date(millis).toLocaleDateString("pt-BR") : "-";
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== day) next.setDate(0);
  return next;
}

function monthKeyFromMillis(millis) {
  if (!millis) return "";
  const date = new Date(millis);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  if (key === "all") return "Todos os meses";
  if (key === "next") return "Próximos meses";
  const [year, month] = String(key).split("-").map(Number);
  if (!year || !month) return key || "-";
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });
}

function currentMonthKey() {
  return monthKeyFromMillis(Date.now());
}

function commissionPaidMillis(item) {
  return dateMillis(item.dataPagamentoComissao || item.dataPagamentoConfirmado);
}

function nextCommissionMillis(item) {
  const explicit = dateMillis(item.proximoVencimento);
  if (explicit) return explicit;
  const paid = commissionPaidMillis(item);
  if (paid) return addMonths(new Date(paid), 1).getTime();
  const activated = dateMillis(item.dataAtivacaoEstabelecimento || item.atualizadoEm || item.criadoEm);
  return activated ? addMonths(new Date(activated), 1).getTime() : 0;
}

function isActiveReferral(item) {
  return ["ativo", "pagando", "convertido"].includes(String(item.status || "").toLowerCase());
}

function selectedMonthValue() {
  return partnerPanelMonth?.value || "all";
}

function populateMonthFilter(referrals) {
  if (!partnerPanelMonth) return;
  const selected = partnerPanelMonth.value || "all";
  const months = new Set();
  referrals.forEach((item) => {
    const paidKey = monthKeyFromMillis(commissionPaidMillis(item));
    const nextKey = monthKeyFromMillis(nextCommissionMillis(item));
    if (paidKey) months.add(paidKey);
    if (nextKey) months.add(nextKey);
  });
  const options = [
    ["all", "Todos os meses"],
    [currentMonthKey(), "Mês atual"],
    ["next", "Próximos meses"],
    ...Array.from(months).sort().reverse().map((key) => [key, monthLabel(key)])
  ];
  const uniqueOptions = Array.from(new Map(options).entries());
  partnerPanelMonth.innerHTML = uniqueOptions
    .map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`)
    .join("");
  partnerPanelMonth.value = uniqueOptions.some(([value]) => value === selected) ? selected : "all";
}

function filterReferralsByMonth(referrals, monthValue) {
  if (!monthValue || monthValue === "all") return referrals;
  const current = currentMonthKey();
  if (monthValue === "next") {
    return referrals.filter(isActiveReferral);
  }
  return referrals.filter((item) => {
    const paidKey = monthKeyFromMillis(commissionPaidMillis(item));
    const nextKey = monthKeyFromMillis(nextCommissionMillis(item));
    return paidKey === monthValue || (isActiveReferral(item) && nextKey === monthValue);
  });
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

function referralStatusLabel(status = "") {
  const labels = {
    novo: "Recebida",
    pendente: "Em análise",
    aprovado: "Aprovada",
    aguardando_pagamento: "Aguardando pagamento",
    aguardando_ativacao: "Aguardando ativação",
    ativo: "Ativo e comissionável",
    pagando: "Ativo e comissionável",
    convertido: "Ativo e comissionável",
    recusado: "Recusada",
    bloqueado: "Bloqueada"
  };
  return labels[String(status).toLowerCase()] || status || "Recebida";
}

function referralLinkFor(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `${location.origin}${location.pathname}?parceiro=${normalized}#indicar` : "";
}

function syncPartnerLink(phone) {
  const link = referralLinkFor(phone);
  if (!partnerLinkCard || !partnerGeneratedLink) return;
  partnerGeneratedLink.value = link;
  partnerLinkCard.classList.toggle("hidden", !link);
  if (partnerPanelLinkCard && partnerPanelLink) {
    partnerPanelLink.value = link;
    partnerPanelLinkCard.classList.toggle("hidden", !link);
  }
}

function updateCalculator(value) {
  const count = safeNumber(value, 1);
  if (calculatorRange) calculatorRange.value = Math.min(count, Number(calculatorRange.max || 500));
  if (calculatorCustom) calculatorCustom.value = count;
  if (calculatorCount) calculatorCount.textContent = count.toLocaleString("pt-BR");
  if (calculatorTotal) calculatorTotal.textContent = `${money(count * 20)}/mês`;
  if (calculatorNote) {
    calculatorNote.textContent = count > 500
      ? "Meta acima da régua. O cálculo continua normalmente, sem limite de indicação."
      : "A régua vai até 500 para simular rápido, mas você pode digitar qualquer quantidade.";
  }
}

function renderPartnerPanel(phone, referrals) {
  const monthValue = selectedMonthValue();
  const filteredReferrals = filterReferralsByMonth(referrals, monthValue);
  const active = referrals.filter(isActiveReferral);
  const filteredActive = filteredReferrals.filter(isActiveReferral);
  const paid = filteredReferrals.filter((item) => String(item.comissaoStatus || "").toLowerCase().includes("pago"));
  const pending = filteredReferrals.filter((item) => !isActiveReferral(item));
  const paidValue = paid.reduce((sum, item) => sum + Number(item.comissaoMensalPrevista || 20), 0);
  const projectedValue = filteredActive.reduce((sum, item) => sum + Number(item.comissaoMensalPrevista || 20), 0);
  const nextCommission = active
    .map((item) => ({ item, millis: nextCommissionMillis(item) }))
    .filter((entry) => entry.millis)
    .sort((a, b) => a.millis - b.millis)[0];

  syncPartnerLink(phone);
  const recurringMessage = active.length
    ? `${active.length} estabelecimento(s) ativo(s). Se continuarem ativos e em dia com os pagamentos, a comissão recorrente prevista é ${money(active.length * 20)}/mês.`
    : "Nenhum estabelecimento ativo para comissão recorrente no momento.";
  setMessage(partnerPanelMessage, referrals.length
    ? `${referrals.length} indicação(ões) encontrada(s). Exibindo ${filteredReferrals.length} em ${monthLabel(monthValue)}. ${recurringMessage}`
    : "Nenhuma indicação encontrada para este WhatsApp.", referrals.length ? "success" : "error");

  if (partnerPanelSummary) {
    partnerPanelSummary.classList.toggle("hidden", !referrals.length);
    partnerPanelSummary.innerHTML = referrals.length ? `
      <article><span>Indicações</span><strong>${referrals.length}</strong></article>
      <article><span>Ativos</span><strong>${active.length}</strong></article>
      <article><span>Em análise</span><strong>${pending.length}</strong></article>
      <article><span>Pago no período</span><strong>${money(paidValue)}</strong></article>
      <article><span>Previsão do período</span><strong>${money(projectedValue)}</strong></article>
      <article><span>Próxima comissão prevista</span><strong>${nextCommission ? formatDate(nextCommission.millis) : "-"}</strong></article>
    ` : "";
  }

  partnerPanelResults.innerHTML = filteredReferrals.length ? filteredReferrals.map((item) => `
    <article class="partner-panel-item">
      <div>
        <strong>${escapeHtml(item.nomeEstabelecimento || "Estabelecimento")}</strong>
        <span>${escapeHtml(referralStatusLabel(item.status))}</span>
      </div>
      <p>${escapeHtml(item.cidade || "-")} · ${escapeHtml(item.segmento || "-")}</p>
      <dl>
        <div><dt>Comissão</dt><dd>${money(Number(item.comissaoMensalPrevista || 20))}/mês</dd></div>
        <div><dt>Próxima comissão prevista</dt><dd>${isActiveReferral(item) ? formatDate(nextCommissionMillis(item)) : "-"}</dd></div>
        <div><dt>Pago em</dt><dd>${formatDate(item.dataPagamentoComissao || item.dataPagamentoConfirmado)}</dd></div>
        <div><dt>Status do pagamento</dt><dd>${escapeHtml(item.comissaoStatus || "aguardando ativação")}</dd></div>
      </dl>
      ${isActiveReferral(item) ? `<small class="partner-recurring-note">Enquanto este estabelecimento continuar ativo e em conformidade com os pagamentos, você segue recebendo ${money(Number(item.comissaoMensalPrevista || 20))}/mês.</small>` : ""}
    </article>
  `).join("") : "<p class=\"partner-empty-state\">Nenhuma indicação encontrada para o mês selecionado.</p>";
}

if (partnerPhoneParam) {
  if (referralForm?.elements.parceiroWhatsapp) {
    referralForm.elements.parceiroWhatsapp.value = partnerPhoneParam;
    referralForm.elements.parceiroWhatsapp.readOnly = true;
    referralForm.elements.parceiroWhatsapp.classList.add("is-locked");
    referralForm.elements.parceiroWhatsapp.title = "WhatsApp do parceiro que gerou este link";
  }
  const panelPhone = document.querySelector("#partner-panel-phone");
  if (panelPhone) panelPhone.value = partnerPhoneParam;
  syncPartnerLink(partnerPhoneParam);
}

calculatorRange?.addEventListener("input", () => updateCalculator(calculatorRange.value));
calculatorCustom?.addEventListener("input", () => updateCalculator(calculatorCustom.value));
updateCalculator(calculatorCustom?.value || calculatorRange?.value || 25);

partnerForm?.elements.whatsapp?.addEventListener("input", () => {
  syncPartnerLink(partnerForm.elements.whatsapp.value);
});

partnerCopyLink?.addEventListener("click", async () => {
  const link = partnerGeneratedLink?.value || "";
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    setMessage(partnerMessage, "Link de indicação copiado.");
  } catch {
    partnerGeneratedLink.select();
    setMessage(partnerMessage, "Link selecionado. Copie usando Ctrl+C.");
  }
});

partnerPanelCopyLink?.addEventListener("click", async () => {
  const link = partnerPanelLink?.value || "";
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    setMessage(partnerPanelMessage, "Link de indicação copiado.");
  } catch {
    partnerPanelLink.select();
    setMessage(partnerPanelMessage, "Link selecionado. Copie usando Ctrl+C.");
  }
});

partnerPanelMonth?.addEventListener("change", () => {
  if (lastPanelPhone) renderPartnerPanel(lastPanelPhone, lastPanelReferrals);
});

partnerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(partnerForm);
  const phone = normalizePhone(data.whatsapp);
  if (phone.length < 10) {
    setMessage(partnerMessage, "Informe um WhatsApp válido para criar seu cadastro de parceiro.", "error");
    return;
  }

  try {
    await setDoc(doc(db, "parceiros", phone), {
      ...data,
      whatsapp: phone,
      status: "ativo",
      comissaoMensalPorAtivo: 20,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    const referralLink = referralLinkFor(phone);
    setMessage(partnerMessage, "Cadastro salvo. Seu link de indicação foi gerado abaixo.");
    syncPartnerLink(phone);
    partnerForm.reset();
    if (referralForm?.elements.parceiroWhatsapp) referralForm.elements.parceiroWhatsapp.value = phone;
    const panelPhone = document.querySelector("#partner-panel-phone");
    if (panelPhone) panelPhone.value = phone;
    if (partnerGeneratedLink) partnerGeneratedLink.value = referralLink;
  } catch (error) {
    setMessage(partnerMessage, `Não foi possível salvar seu cadastro: ${error.message}`, "error");
  }
});

referralForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(referralForm);
  const parceiroWhatsapp = normalizePhone(data.parceiroWhatsapp);
  const estabelecimentoWhatsapp = normalizePhone(data.whatsapp);
  const emailNormalizado = normalizeEmail(data.email);

  if (parceiroWhatsapp.length < 10 || estabelecimentoWhatsapp.length < 10 || !emailNormalizado) {
    setMessage(referralMessage, "Informe WhatsApp do parceiro, WhatsApp do estabelecimento e e-mail corretamente.", "error");
    return;
  }

  try {
    const referralRef = doc(collection(db, "indicacoes_parceiros"));
    const requestRef = doc(db, "solicitacoes_estabelecimentos", emailNormalizado);
    const baseData = {
      nomeEstabelecimento: data.nomeEstabelecimento,
      responsavel: data.responsavel,
      whatsapp: estabelecimentoWhatsapp,
      whatsappEstabelecimento: estabelecimentoWhatsapp,
      email: emailNormalizado,
      emailNormalizado,
      documento: normalizeDocument(data.documento),
      cidade: data.cidade,
      estabelecimentoEndereco: data.estabelecimentoEndereco,
      estabelecimentoNumero: data.estabelecimentoNumero,
      estabelecimentoBairro: data.estabelecimentoBairro,
      estabelecimentoCep: data.estabelecimentoCep,
      estabelecimentoComplemento: data.estabelecimentoComplemento,
      estabelecimentoLatitude: "",
      estabelecimentoLongitude: "",
      segmento: data.segmento,
      observacao: data.observacao || "",
      origem: "bq_parceiro",
      parceiroWhatsapp,
      indicacaoParceiroId: referralRef.id
    };

    await setDoc(requestRef, {
      ...baseData,
      status: "pendente",
      dataCadastro: serverTimestamp()
    });

    await setDoc(referralRef, {
      ...baseData,
      status: "novo",
      comissaoMensalPrevista: 20,
      comissaoStatus: "aguardando_ativacao",
      estabelecimentoId: "",
      dataAtivacaoEstabelecimento: null,
      dataPagamentoConfirmado: null,
      dataPagamentoComissao: null,
      proximoVencimento: null,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    await setDoc(doc(db, "parceiros", parceiroWhatsapp), {
      whatsapp: parceiroWhatsapp,
      status: "ativo",
      comissaoMensalPorAtivo: 20,
      ultimaIndicacaoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    const message = [
      "Olá, registrei uma indicação no bq parceiro.",
      "",
      `Código da indicação: ${referralRef.id}`,
      `Estabelecimento: ${data.nomeEstabelecimento}`,
      `Responsável: ${data.responsavel}`,
      `WhatsApp: ${estabelecimentoWhatsapp}`,
      `E-mail: ${emailNormalizado}`,
      data.cidade ? `Cidade: ${data.cidade}` : "",
      data.segmento ? `Segmento: ${data.segmento}` : "",
      "",
      "A solicitação já foi enviada para análise no admin."
    ].filter(Boolean).join("\n");

    setMessage(referralMessage, "Indicação registrada e enviada para análise. Abrindo WhatsApp para avisar a equipe...");
    referralForm.reset();
    referralForm.elements.parceiroWhatsapp.value = parceiroWhatsapp;
    setTimeout(() => {
      location.href = whatsappLink(supportPhone, message);
    }, 450);
  } catch (error) {
    const text = String(error?.message || "").includes("permission") || String(error?.code || "").includes("permission")
      ? "Não foi possível registrar. Confira se esse e-mail já tem uma solicitação aberta ou se as regras do Firebase foram atualizadas."
      : `Não foi possível registrar a indicação: ${error.message}`;
    setMessage(referralMessage, text, "error");
  }
});

partnerPanelForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const phone = normalizePhone(new FormData(partnerPanelForm).get("whatsapp"));
  if (phone.length < 10) {
    setMessage(partnerPanelMessage, "Informe seu WhatsApp de parceiro para consultar.", "error");
    return;
  }

  setMessage(partnerPanelMessage, "Buscando indicações...");
  partnerPanelResults.innerHTML = "";
  if (partnerPanelSummary) {
    partnerPanelSummary.classList.add("hidden");
    partnerPanelSummary.innerHTML = "";
  }

  try {
    const referralSnap = await getDocs(query(
      collection(db, "indicacoes_parceiros"),
      where("parceiroWhatsapp", "==", phone),
      limit(50)
    ));
    const referrals = referralSnap.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => dateMillis(b.criadoEm) - dateMillis(a.criadoEm));
    lastPanelPhone = phone;
    lastPanelReferrals = referrals;
    populateMonthFilter(referrals);
    renderPartnerPanel(phone, referrals);
  } catch (error) {
    setMessage(partnerPanelMessage, `Não foi possível consultar: ${error.message}`, "error");
  }
});
