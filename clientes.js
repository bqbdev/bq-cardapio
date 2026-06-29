import { db, doc, getDoc, setDoc, serverTimestamp } from "./firebase.js";
import { normalizePhone } from "./utils.js";

export async function getClientByWhatsApp(estabelecimentoId, whatsapp) {
  const cleanPhone = normalizePhone(whatsapp);
  const snap = await getDoc(doc(db, `estabelecimentos/${estabelecimentoId}/clientes`, cleanPhone));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertClient(estabelecimentoId, client, orderTotal) {
  const cleanPhone = normalizePhone(client.whatsapp);
  const current = await getClientByWhatsApp(estabelecimentoId, cleanPhone);
  await setDoc(doc(db, `estabelecimentos/${estabelecimentoId}/clientes`, cleanPhone), {
    ...client,
    whatsapp: cleanPhone,
    dataCadastro: current?.dataCadastro || serverTimestamp(),
    ultimaCompra: serverTimestamp(),
    totalCompras: Number(current?.totalCompras || 0) + 1,
    valorTotalComprado: Number(current?.valorTotalComprado || 0) + Number(orderTotal || 0)
  }, { merge: true });
  return cleanPhone;
}
