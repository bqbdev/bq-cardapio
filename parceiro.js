import {
  db,
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
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
const partnerPanelResults = document.querySelector("#partner-panel-results");
const calculatorRange = document.querySelector("#partner-calculator-range");
const calculatorCustom = document.querySelector("#partner-calculator-custom");
const calculatorCount = document.querySelector("#partner-calculator-count");
const calculatorTotal = document.querySelector("#partner-calculator-total");
const calculatorNote = document.querySelector("#partner-calculator-note");
const partnerPhoneParam = new URLSearchParams(location.search).get("parceiro") || "";
const supportPhone = "19995016307";

if (partnerPhoneParam) {
  if (referralForm?.elements.parceiroWhatsapp) referralForm.elements.parceiroWhatsapp.value = partnerPhoneParam;
  const panelPhone = document.querySelector("#partner-panel-phone");
  if (panelPhone) panelPhone.value = partnerPhoneParam;
}

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

function formatDate(value) {
  if (!value) return "-";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
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

calculatorRange?.addEventListener("input", () => updateCalculator(calculatorRange.value));
calculatorCustom?.addEventListener("input", () => updateCalculator(calculatorCustom.value));
updateCalculator(calculatorCustom?.value || calculatorRange?.value || 25);

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

    const referralLink = `${location.origin}${location.pathname}?parceiro=${phone}#indicar`;
    setMessage(partnerMessage, `Cadastro salvo. Seu link de indicação: ${referralLink}`);
    partnerForm.reset();
    if (referralForm?.elements.parceiroWhatsapp) referralForm.elements.parceiroWhatsapp.value = phone;
    const panelPhone = document.querySelector("#partner-panel-phone");
    if (panelPhone) panelPhone.value = phone;
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
    const alreadyExists = String(error?.message || "").includes("permission") || String(error?.code || "").includes("permission");
    const text = alreadyExists
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

  try {
    const referralSnap = await getDocs(query(
      collection(db, "indicacoes_parceiros"),
      where("parceiroWhatsapp", "==", phone),
      orderBy("criadoEm", "desc"),
      limit(50)
    ));
    const referrals = referralSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
    const active = referrals.filter((item) => ["ativo", "pagando", "convertido"].includes(String(item.status || "").toLowerCase()));
    setMessage(partnerPanelMessage, referrals.length
      ? `${referrals.length} indicação(ões) encontrada(s). Previsão atual: ${money(active.length * 20)}/mês.`
      : "Nenhuma indicação encontrada para este WhatsApp.", referrals.length ? "success" : "error");

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
          <div><dt>Pagamento</dt><dd>${escapeHtml(item.comissaoStatus || "aguardando ativação")}</dd></div>
        </dl>
      </article>
    `).join("");
  } catch (error) {
    setMessage(partnerPanelMessage, `Não foi possível consultar: ${error.message}`, "error");
  }
});
