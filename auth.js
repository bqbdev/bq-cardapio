import {
  auth,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  serverTimestamp,
  signInWithEmailAndPassword
} from "./firebase.js";
import { formToObject, normalizePhone, setMessage } from "./utils.js";
import { fillCoordinatesFromAddress } from "./geocoding.js";

const signupForm = document.querySelector("#signup-request-form");
const signupMessage = document.querySelector("#signup-message");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");

document.querySelector("#signup-location")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setMessage(signupMessage, "Seu navegador não permite pegar localização.", "error");
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    signupForm.elements.estabelecimentoLatitude.value = position.coords.latitude.toFixed(6);
    signupForm.elements.estabelecimentoLongitude.value = position.coords.longitude.toFixed(6);
    setMessage(signupMessage, "Localização preenchida.");
  }, () => {
    setMessage(signupMessage, "Não foi possível pegar a localização. Verifique a permissão do navegador.", "error");
  }, { enableHighAccuracy: true, timeout: 12000 });
});

document.querySelector("#signup-geocode")?.addEventListener("click", async () => {
  try {
    setMessage(signupMessage, "Buscando coordenadas pelo endereço...");
    await fillCoordinatesFromAddress(signupForm);
    setMessage(signupMessage, "Coordenadas preenchidas pelo endereço.");
  } catch (error) {
    setMessage(signupMessage, error.message, "error");
  }
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

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formToObject(signupForm);
    const emailNormalizado = normalizeEmail(data.email);
    try {
      if (!data.estabelecimentoLatitude || !data.estabelecimentoLongitude) {
        const result = await fillCoordinatesFromAddress(signupForm);
        data.estabelecimentoLatitude = String(result.latitude);
        data.estabelecimentoLongitude = String(result.longitude);
      }
      await setDoc(doc(db, "solicitacoes_estabelecimentos", emailNormalizado), {
        ...data,
        email: emailNormalizado,
        emailNormalizado,
        whatsapp: normalizePhone(data.whatsapp),
        status: "pendente",
        dataCadastro: serverTimestamp()
      });
      signupForm.reset();
      setMessage(signupMessage, "Cadastro enviado com sucesso. Aguarde aprovação da equipe.");
    } catch (error) {
      const duplicate = String(error.code || "").includes("permission-denied");
      setMessage(signupMessage, duplicate
        ? "Já existe uma solicitação com este e-mail. Aguarde a aprovação ou fale com o suporte."
        : `Não foi possível enviar: ${error.message}`, "error");
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { email, password } = formToObject(loginForm);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const adminSnap = await getDoc(doc(db, "admins", credential.user.uid));
      if (adminSnap.exists()) {
        location.href = "admin.html";
        return;
      }
      const businesses = await getDocs(query(collection(db, "estabelecimentos"), where("uid", "==", credential.user.uid)));
      if (businesses.empty) {
        setMessage(loginMessage, "Seu usuário ainda não está vinculado a um estabelecimento aprovado.", "error");
        return;
      }
      const business = businesses.docs[0].data();
      if (!["ativo"].includes(String(business.status || "").toLowerCase())) {
        setMessage(loginMessage, "Acesso temporariamente bloqueado. Fale com a administração da plataforma.", "error");
        return;
      }
      sessionStorage.setItem("businessId", businesses.docs[0].id);
      location.href = "painel.html";
    } catch (error) {
      setMessage(loginMessage, `Falha no login: ${error.message}`, "error");
    }
  });
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase().replace(/\//g, "-");
}
