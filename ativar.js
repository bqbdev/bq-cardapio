import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

document.querySelector("#activation-intro").textContent = `Crie sua senha para ativar a conta de ${nome}.`;
if (form?.elements.email) form.elements.email.value = email;

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const field = button.closest(".password-field")?.querySelector("input");
    if (!field) return;
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    button.textContent = show ? "Ocultar" : "Mostrar";
  });
});

if (!estabelecimentoId || !token || !email) {
  setMessage(message, "Link de ativacao invalido. Solicite um novo link ao administrador.", "error");
  form?.querySelector("button[type='submit']")?.setAttribute("disabled", "disabled");
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
    const credential = await createOrSignInActivationUser(email, data.password);
    const businessSnap = await getDoc(doc(db, "estabelecimentos", estabelecimentoId));
    const currentBusiness = businessSnap.data() || {};
    const activationDate = new Date();
    const renewalDate = addMonths(activationDate, planMonths(params.get("plano") || ""));
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoId), {
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
    setMessage(message, `Não foi possível ativar: ${error.message}`, "error");
  }
});

async function createOrSignInActivationUser(email, password) {
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (String(error.code || "").includes("email-already-in-use")) {
      return signInWithEmailAndPassword(auth, email, password);
    }
    throw error;
  }
}
