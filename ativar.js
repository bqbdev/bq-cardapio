import {
  auth,
  db,
  createUserWithEmailAndPassword,
  doc,
  updateDoc,
  serverTimestamp
} from "./firebase.js";
import { formToObject, setMessage } from "./utils.js";

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
    setMessage(message, "As senhas nao conferem.", "error");
    return;
  }
  if (data.password.length < 6) {
    setMessage(message, "A senha precisa ter pelo menos 6 caracteres.", "error");
    return;
  }
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, data.password);
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoId), {
      uid: credential.user.uid,
      status: "ativo",
      dataAtivacao: serverTimestamp(),
      activationTokenConfirm: token
    });
    setMessage(message, "Conta ativada com sucesso. Redirecionando para o painel...");
    setTimeout(() => {
      location.href = "painel.html";
    }, 1200);
  } catch (error) {
    const alreadyExists = String(error.code || "").includes("email-already-in-use");
    setMessage(message, alreadyExists
      ? "Este e-mail ja possui uma conta. Fale com o administrador para reenviar ou ajustar o acesso."
      : `Nao foi possivel ativar: ${error.message}`, "error");
  }
});
