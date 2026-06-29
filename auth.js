import {
  auth,
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  signInWithEmailAndPassword
} from "./firebase.js";
import { formToObject, normalizePhone, setMessage } from "./utils.js";

const signupForm = document.querySelector("#signup-request-form");
const signupMessage = document.querySelector("#signup-message");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formToObject(signupForm);
    try {
      await addDoc(collection(db, "solicitacoes_estabelecimentos"), {
        ...data,
        whatsapp: normalizePhone(data.whatsapp),
        status: "pendente",
        dataCadastro: serverTimestamp()
      });
      signupForm.reset();
      setMessage(signupMessage, "Cadastro enviado com sucesso. Aguarde aprovacao da equipe.");
    } catch (error) {
      setMessage(signupMessage, `Nao foi possivel enviar: ${error.message}`, "error");
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
        setMessage(loginMessage, "Seu usuario ainda nao esta vinculado a um estabelecimento aprovado.", "error");
        return;
      }
      const business = businesses.docs[0].data();
      if (!["ativo"].includes(String(business.status || "").toLowerCase())) {
        setMessage(loginMessage, "Acesso temporariamente bloqueado. Fale com a administracao da plataforma.", "error");
        return;
      }
      location.href = "painel.html";
    } catch (error) {
      setMessage(loginMessage, `Falha no login: ${error.message}`, "error");
    }
  });
}
