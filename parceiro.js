import {
  db,
  collection,
  doc,
  setDoc,
  addDoc,
  serverTimestamp
} from "./firebase.js";
import { formToObject, money, normalizePhone, setMessage, whatsappLink } from "./utils.js";

const partnerForm = document.querySelector("#partner-form");
const referralForm = document.querySelector("#referral-form");
const partnerMessage = document.querySelector("#partner-message");
const referralMessage = document.querySelector("#referral-message");
const calculator = document.querySelector("#partner-calculator-input");
const calculatorCount = document.querySelector("#partner-calculator-count");
const calculatorTotal = document.querySelector("#partner-calculator-total");
const partnerPhoneParam = new URLSearchParams(location.search).get("parceiro") || "";
const supportPhone = "19995016307";

if (partnerPhoneParam && referralForm?.elements.parceiroWhatsapp) {
  referralForm.elements.parceiroWhatsapp.value = partnerPhoneParam;
}

calculator?.addEventListener("input", () => {
  const count = Number(calculator.value || 0);
  calculatorCount.textContent = count;
  calculatorTotal.textContent = `${money(count * 20)}/mês`;
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
      totalIndicacoes: 0,
      totalAtivos: 0,
      ganhoMensalPrevisto: 0,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    const referralLink = `${location.origin}${location.pathname}?parceiro=${phone}#indicar`;
    setMessage(partnerMessage, `Cadastro salvo. Seu link de indicação: ${referralLink}`);
    partnerForm.reset();
    if (referralForm?.elements.parceiroWhatsapp) referralForm.elements.parceiroWhatsapp.value = phone;
  } catch (error) {
    setMessage(partnerMessage, `Não foi possível salvar seu cadastro: ${error.message}`, "error");
  }
});

referralForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(referralForm);
  const parceiroWhatsapp = normalizePhone(data.parceiroWhatsapp);
  const estabelecimentoWhatsapp = normalizePhone(data.whatsappEstabelecimento);

  if (parceiroWhatsapp.length < 10 || estabelecimentoWhatsapp.length < 10) {
    setMessage(referralMessage, "Informe o WhatsApp do parceiro e do estabelecimento corretamente.", "error");
    return;
  }

  try {
    const referralRef = await addDoc(collection(db, "indicacoes_parceiros"), {
      ...data,
      parceiroWhatsapp,
      whatsappEstabelecimento: estabelecimentoWhatsapp,
      status: "novo",
      comissaoMensalPrevista: 20,
      estabelecimentoId: "",
      dataAtivacaoEstabelecimento: null,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    });

    await setDoc(doc(db, "parceiros", parceiroWhatsapp), {
      whatsapp: parceiroWhatsapp,
      status: "pendente",
      comissaoMensalPorAtivo: 20,
      ultimaIndicacaoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }, { merge: true });

    const message = [
      "Olá, acabei de registrar uma indicação no bq parceiro.",
      "",
      `Código da indicação: ${referralRef.id}`,
      `Estabelecimento: ${data.nomeEstabelecimento}`,
      `WhatsApp: ${estabelecimentoWhatsapp}`,
      data.cidade ? `Cidade: ${data.cidade}` : "",
      data.segmento ? `Segmento: ${data.segmento}` : "",
      "",
      "Quero acompanhar essa indicação."
    ].filter(Boolean).join("\n");

    setMessage(referralMessage, "Indicação registrada com sucesso. Abrindo WhatsApp para avisar a equipe...");
    referralForm.reset();
    referralForm.elements.parceiroWhatsapp.value = parceiroWhatsapp;
    setTimeout(() => {
      location.href = whatsappLink(supportPhone, message);
    }, 450);
  } catch (error) {
    setMessage(referralMessage, `Não foi possível registrar a indicação: ${error.message}`, "error");
  }
});
