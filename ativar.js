import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  doc,
  getDoc,
  updateDoc,
  Timestamp
} from "./firebase.js";
import { addMonths, formToObject, planMonths, setMessage } from "./utils.js";

const params = new URLSearchParams(location.search);
const estabelecimentoId = params.get("estabelecimento") || "";
const token = params.get("token") || "";
const email = params.get("email") || "";
const nome = params.get("nome") || "seu estabelecimento";
const form = document.querySelector("#activation-form");
const message = document.querySelector("#activation-message");
const submitButton = form?.querySelector("button[type='submit']");
let activationEmail = email;
let activationReady = false;

document.querySelector("#activation-intro").textContent = `Crie sua senha para ativar a conta de ${nome}.`;
if (form?.elements.email) form.elements.email.value = email;

["password", "passwordConfirm"].forEach((fieldName) => {
  form?.elements[fieldName]?.addEventListener("input", refreshSubmitButton);
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const field = button.closest(".password-field")?.querySelector("input");
    if (!field) return;
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";
  });
});

if (!estabelecimentoId || !token) {
  setMessage(message, "Link de ativação inválido. Solicite um novo link ao administrador.", "error");
  submitButton?.setAttribute("disabled", "disabled");
} else {
  loadActivationData();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = formToObject(form);
  if (data.password !== data.passwordConfirm) {
    setMessage(message, "As senhas não conferem.", "error");
    return;
  }
  if (data.password.length < 6) {
    setMessage(message, "A senha precisa ter pelo menos 6 caracteres.", "error");
    return;
  }
  try {
    setActivationLoading(true);
    const businessRef = doc(db, "estabelecimentos", estabelecimentoId);
    const businessSnap = await getDoc(businessRef);
    if (!businessSnap.exists()) {
      throw new Error("Estabelecimento não encontrado. Solicite um novo link ao administrador.");
    }
    const currentBusiness = businessSnap.data() || {};
    if (currentBusiness.activationToken && currentBusiness.activationToken !== token) {
      throw new Error("Link de ativação inválido. Solicite um novo link ao administrador.");
    }
    if (currentBusiness.uid && currentBusiness.status === "ativo") {
      sessionStorage.setItem("businessId", estabelecimentoId);
      setMessage(message, "Conta já ativada. Redirecionando para o painel...");
      setTimeout(() => {
        location.href = "painel.html";
      }, 900);
      return;
    }

    activationEmail = currentBusiness.email || activationEmail;
    if (!activationEmail) {
      throw new Error("E-mail de acesso não encontrado. Solicite um novo link ao administrador.");
    }

    const credential = await createOrSignInActivationUser(activationEmail, data.password);
    const activationDate = new Date();
    const renewalDate = addMonths(activationDate, planMonths(params.get("plano") || ""));
    await updateDoc(businessRef, {
      uid: credential.user.uid,
      status: "ativo",
      dataAtivacao: currentBusiness.dataAtivacao || Timestamp.fromDate(activationDate),
      dataInicio: currentBusiness.dataInicio || Timestamp.fromDate(activationDate),
      proximoVencimento: currentBusiness.proximoVencimento || Timestamp.fromDate(renewalDate),
      activationTokenConfirm: token
    });
    sessionStorage.setItem("businessId", estabelecimentoId);
    setMessage(message, "Conta ativada com sucesso. Redirecionando para o painel...");
    setTimeout(() => {
      location.href = "painel.html";
    }, 1200);
  } catch (error) {
    setMessage(message, activationErrorMessage(error), "error");
    setActivationLoading(false);
    refreshSubmitButton();
  }
});

async function loadActivationData() {
  try {
    submitButton?.setAttribute("disabled", "disabled");
    const businessSnap = await getDoc(doc(db, "estabelecimentos", estabelecimentoId));
    if (!businessSnap.exists()) {
      throw new Error("Estabelecimento não encontrado. Solicite um novo link ao administrador.");
    }
    const business = businessSnap.data() || {};
    if (business.activationToken && business.activationToken !== token) {
      throw new Error("Link de ativação inválido. Solicite um novo link ao administrador.");
    }

    activationEmail = business.email || activationEmail;
    const businessName = business.nomeEstabelecimento || nome;
    document.querySelector("#activation-intro").textContent = `Crie sua senha para ativar a conta de ${businessName}.`;
    if (form?.elements.email) form.elements.email.value = activationEmail;

    if (business.uid && business.status === "ativo") {
      sessionStorage.setItem("businessId", estabelecimentoId);
      setMessage(message, "Conta já ativada. Redirecionando para o painel...");
      setTimeout(() => {
        location.href = "painel.html";
      }, 900);
      return;
    }

    activationReady = true;
    refreshSubmitButton();
  } catch (error) {
    setMessage(message, error.message, "error");
    submitButton?.setAttribute("disabled", "disabled");
  }
}

function refreshSubmitButton() {
  if (!submitButton || !activationReady) return;
  const password = form?.elements.password?.value || "";
  const passwordConfirm = form?.elements.passwordConfirm?.value || "";
  if (password.length >= 6 && password === passwordConfirm) {
    submitButton.removeAttribute("disabled");
  } else {
    submitButton.setAttribute("disabled", "disabled");
  }
}

function setActivationLoading(isLoading) {
  if (!submitButton) return;
  submitButton.textContent = isLoading ? "Ativando conta..." : "Ativar minha conta";
  if (isLoading) {
    submitButton.setAttribute("disabled", "disabled");
  }
}

async function createOrSignInActivationUser(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (String(error.code || "").includes("email-already-in-use")) {
      try {
        return await signInWithEmailAndPassword(auth, email, password);
      } catch (signInError) {
        if (isInvalidCredential(signInError)) {
          await sendPasswordResetEmail(auth, email);
          throw new Error("Este e-mail já existe no Firebase Authentication com outra senha. Enviei um e-mail de redefinição de senha. Depois de redefinir, entre pelo painel.");
        }
        throw signInError;
      }
    }
    throw error;
  }
}

function isInvalidCredential(error) {
  const code = String(error?.code || "");
  return code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found");
}

function activationErrorMessage(error) {
  const messageText = String(error?.message || "");
  if (messageText.includes("Firebase: Error")) {
    return messageText.replace(/^Firebase:\s*/i, "").replace(/\.$/, "");
  }
  return `Não foi possível ativar: ${messageText}`;
}
