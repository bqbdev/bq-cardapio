import { increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, collection, doc, getDoc, getDocs, limit, query, setDoc, serverTimestamp, where } from "./firebase.js";
import { normalizePhone } from "./utils.js";

function phoneCandidates(phone) {
  const cleanPhone = normalizePhone(phone);
  const withoutCountry = cleanPhone.startsWith("55") && cleanPhone.length > 11
    ? cleanPhone.slice(2)
    : cleanPhone;
  const withCountry = withoutCountry ? `55${withoutCountry}` : cleanPhone;
  return Array.from(new Set([
    cleanPhone,
    withoutCountry,
    withCountry,
    `+${withCountry}`
  ].filter(Boolean)));
}

export async function getClientByWhatsApp(estabelecimentoId, whatsapp) {
  const candidates = phoneCandidates(whatsapp);
  const clientsPath = `estabelecimentos/${estabelecimentoId}/clientes`;

  for (const candidate of candidates) {
    const snap = await getDoc(doc(db, clientsPath, candidate));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
  }

  for (const candidate of candidates) {
    try {
      const snap = await getDocs(query(
        collection(db, clientsPath),
        where("whatsapp", "==", candidate),
        limit(1)
      ));
      if (!snap.empty) {
        const clientDoc = snap.docs[0];
        return { id: clientDoc.id, ...clientDoc.data() };
      }
    } catch (error) {
      console.warn("Busca alternativa de cliente não permitida pelas regras atuais:", error);
      return null;
    }
  }

  return null;
}

export async function upsertClient(estabelecimentoId, client, orderTotal) {
  const cleanPhone = normalizePhone(client.whatsapp);
  let current = null;
  try {
    current = await getClientByWhatsApp(estabelecimentoId, cleanPhone);
  } catch (error) {
    console.warn("Cliente ainda não pode ser lido publicamente. Salvando sem leitura prévia:", error);
  }
  await setDoc(doc(db, `estabelecimentos/${estabelecimentoId}/clientes`, cleanPhone), {
    ...client,
    whatsapp: cleanPhone,
    telefoneNormalizado: cleanPhone,
    telefonesBusca: phoneCandidates(cleanPhone),
    dataCadastro: current?.dataCadastro || serverTimestamp(),
    ultimaCompra: serverTimestamp(),
    totalCompras: increment(1),
    valorTotalComprado: increment(Number(orderTotal || 0))
  }, { merge: true });
  return cleanPhone;
}
