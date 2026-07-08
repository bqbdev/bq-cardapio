import { increment } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";
import { normalizePhone } from "./utils.js";

export async function getClientByWhatsApp(estabelecimentoId, whatsapp) {
  const cleanPhone = normalizePhone(whatsapp);
  const snap = await getDoc(doc(db, `estabelecimentos/${estabelecimentoId}/clientes`, cleanPhone));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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
    dataCadastro: current?.dataCadastro || serverTimestamp(),
    ultimaCompra: serverTimestamp(),
    totalCompras: increment(1),
    valorTotalComprado: increment(Number(orderTotal || 0))
  }, { merge: true });
  return cleanPhone;
}
