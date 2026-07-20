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
  const active = referrals.filter((item) => ["ativo", "pagando", "convertido"].includes(String(item.status || "").toLowerCase()));
  const paid = referrals.filter((item) => String(item.comissaoStatus || "").toLowerCase().includes("pago"));
  const pending = referrals.filter((item) => !["ativo", "pagando", "convertido"].includes(String(item.status || "").toLowerCase()));
  const nextBilling = active
    .map((item) => ({ item, millis: dateMillis(item.proximoVencimento) }))
    .filter((entry) => entry.millis)
    .sort((a, b) => a.millis - b.millis)[0]?.item;

  syncPartnerLink(phone);
  setMessage(partnerPanelMessage, referrals.length
    ? `${referrals.length} indicação(ões) encontrada(s). Previsão atual: ${money(active.length * 20)}/mês.`
    : "Nenhuma indicação encontrada para este WhatsApp.", referrals.length ? "success" : "error");

  if (partnerPanelSummary) {
    partnerPanelSummary.classList.toggle("hidden", !referrals.length);
    partnerPanelSummary.innerHTML = referrals.length ? `
      <article><span>Indicações</span><strong>${referrals.length}</strong></article>
      <article><span>Ativos</span><strong>${active.length}</strong></article>
      <article><span>Em análise</span><strong>${pending.length}</strong></article>
      <article><span>Comissão prevista</span><strong>${money(active.length * 20)}/mês</strong></article>
      <article><span>Comissões pagas</span><strong>${paid.length}</strong></article>
      <article><span>Próxima cobrança</span><strong>${nextBilling ? formatDate(nextBilling.proximoVencimento) : "-"}</strong></article>
    ` : "";
  }

  partnerPanelResults.innerHTML = referrals.map((item) => `
    <article class="partner-panel-item">
      <div>
        <strong>${escapeHtml(item.nomeEstabelecimento || "Estabelecimento")}</strong>
        <span>${escapeHtml(referralStatusLabel(item.status))}</span>
      </div>
      <p>${escapeHtml(item.cidade || "-")} · ${escapeHtml(item.segmento || "-")}</p>
      <dl>
        <div><dt>Comissão</dt><dd>${money(Number(item.comissaoMensalPrevista || 20))}/mês</dd></div>
        <div><dt>Próxima cobrança</dt><dd>${formatDate(item.proximoVencimento)}</dd></div>
        <div><dt>Pago em</dt><dd>${formatDate(item.dataPagamentoComissao || item.dataPagamentoConfirmado)}</dd></div>
        <div><dt>Status do pagamento</dt><dd>${escapeHtml(item.comissaoStatus || "aguardando ativação")}</dd></div>
      </dl>
    </article>
  `).join("");
}

if (partnerPhoneParam) {
  if (referralForm?.elements.parceiroWhatsapp) referralForm.elements.parceiroWhatsapp.value = partnerPhoneParam;
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
    renderPartnerPanel(phone, referrals);
  } catch (error) {
    setMessage(partnerPanelMessage, `Não foi possível consultar: ${error.message}`, "error");
  }
});
