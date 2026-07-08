import { Timestamp } from "./firebase.js";

export const money = (value = 0) => Number(value || 0).toLocaleString("pt-BR", {
  style: "currency",
  currency: "BRL"
});

export const numberValue = (value) => Number(String(value || "0").replace(",", ".")) || 0;

export const normalizePhone = (phone = "") => String(phone).replace(/\D/g, "");

export const slugify = (text = "") => String(text)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

export const todayStart = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(date);
};

export const toDateInput = (value) => {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

export const fromDateInput = (value) => value ? Timestamp.fromDate(new Date(`${value}T12:00:00`)) : null;

export const toBrazilDate = (value) => {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR");
};

export const addMonths = (value, months = 1) => {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

export const planMonths = (plan = "") => {
  const normalized = String(plan).toLowerCase();
  if (normalized.includes("anual")) return 12;
  if (normalized.includes("semestral")) return 6;
  if (normalized.includes("trimestral")) return 3;
  return 1;
};

export const setMessage = (element, text, type = "success") => {
  if (!element) return;
  element.textContent = text;
  element.className = `form-message ${type}`;
};

export const formToObject = (form) => {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === "string" ? value.trim() : value;
  });
  form.querySelectorAll("input[type='checkbox']").forEach((input) => {
    data[input.name] = input.checked;
  });
  return data;
};

export const requireParam = (name, fallback = "") => new URLSearchParams(location.search).get(name) || fallback;

export const whatsappRecipient = (phone = "") => {
  const digits = normalizePhone(phone);
  if (!digits) return "";
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return `55${digits}`;
};

export const whatsappLink = (phone, message) => `https://wa.me/${whatsappRecipient(phone)}?text=${encodeURIComponent(message)}`;

export const orderCode = () => `BQ-${Date.now().toString(36).toUpperCase()}`;

export const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;"
}[char]));

export const printOrder = (order, mode = false) => {
  const kitchen = mode === true || mode === "cozinha";
  const delivery = mode === "motoboy";
  const items = (order.itens || []).map((item) => `
    <div>
      <strong>${escapeHtml(item.nome)}</strong> x ${item.quantidade || 1}<br>
      ${item.tamanho ? `Tamanho: ${escapeHtml(item.tamanho.nome)}<br>` : ""}
      ${item.sabores?.length ? `Sabores: ${escapeHtml(item.sabores.map((flavor) => flavor.nome).join(", "))}<br>` : ""}
      ${item.bordas?.length ? `Borda: ${escapeHtml(item.bordas.map((addon) => addon.nome).join(", "))}<br>` : ""}
      ${item.adicionais?.length ? `Adicionais: ${escapeHtml(item.adicionais.map((addon) => addon.nome).join(", "))}<br>` : ""}
      ${escapeHtml(item.observacao || "")}
    </div>
  `).join("");
  const address = order.endereco || {};
  const deliveryAddress = [
    address.endereco,
    address.numero,
    address.bairro,
    address.cidade
  ].filter(Boolean).join(", ");
  const title = delivery ? "Motoboy" : kitchen ? "Cozinha" : "Cliente";
  const html = `
    <html><head><title>Pedido ${order.codigo}</title>
    <style>body{font-family:monospace;width:280px;margin:0;padding:10px}hr{border:0;border-top:1px dashed #000}h1{font-size:18px}</style></head>
    <body>
      <h1>${title} - ${escapeHtml(order.codigo || "")}</h1>
      <p>${escapeHtml(order.clienteNome || "")}<br>${escapeHtml(order.whatsapp || "")}</p>
      ${delivery ? `<hr><p><strong>Entrega</strong><br>${escapeHtml(deliveryAddress || "Endereço não informado")}<br>${escapeHtml(address.complemento || "")}<br>${escapeHtml(address.referencia || "")}</p>` : ""}
      <hr>${items}<hr>
      ${kitchen ? "" : `<p>Pagamento: ${escapeHtml(order.formaPagamento || "")}<br>Entrega: ${money(order.taxaEntrega || 0)}<br>Total: ${money(order.totalFinal)}</p>`}
      <script>window.print();<\/script>
    </body></html>`;
  const win = window.open("", "_blank", "width=360,height=640");
  win.document.write(html);
  win.document.close();
};
