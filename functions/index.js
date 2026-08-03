const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const FALLBACK_IMAGE = "/logo.png";

exports.previewCardapio = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 10,
  minInstances: 0,
  maxInstances: 5,
  concurrency: 80,
  serviceAccount: "585287341859-compute@developer.gserviceaccount.com",
  invoker: "public",
  cors: false
}, async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.set("Allow", "GET, HEAD").status(405).send("Método não permitido.");
    return;
  }

  const pathParts = String(request.path || "").split("/").filter(Boolean);
  const estabelecimentoId = safeDocumentId(pathParts[1] || request.query.estabelecimento);
  const origin = requestOrigin(request);

  if (!estabelecimentoId) {
    response.status(404).send(renderUnavailable(origin, "Cardápio não encontrado"));
    return;
  }

  try {
    const [businessSnap, settingsSnap] = await Promise.all([
      db.doc(`estabelecimentos/${estabelecimentoId}`).get(),
      db.doc(`estabelecimentos/${estabelecimentoId}/configuracoes/geral`).get()
    ]);
    const business = businessSnap.data() || {};
    const settings = settingsSnap.data() || {};

    if (!businessSnap.exists || business.status !== "ativo") {
      response.status(404).send(renderUnavailable(origin, "Cardápio indisponível"));
      return;
    }

    const name = cleanText(settings.nomePublico || business.nomeEstabelecimento || "bq menu", 90);
    const slug = slugify(name) || "cardapio";
    const description = cleanText(settings.descricaoCompartilhamento || `Confira o cardápio de ${name} e faça seu pedido.`, 180);
    const image = absoluteHttpUrl(settings.logoUrl || business.logoUrl || business.fotoUrl, origin) || `${origin}${FALLBACK_IMAGE}`;
    const shareUrl = `${origin}/loja/${encodeURIComponent(estabelecimentoId)}/${slug}`;
    const menuUrl = `${origin}/cardapio.html?${new URLSearchParams({ loja: slug, estabelecimento: estabelecimentoId })}`;

    response.set({
      "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=86400",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, follow"
    });
    response.status(200).send(renderPreview({ name, description, image, shareUrl, menuUrl }));
  } catch (error) {
    console.error("Falha ao gerar prévia do cardápio", { estabelecimentoId, error: error.message });
    response.set("Cache-Control", "no-store").status(500).send(renderUnavailable(origin, "Não foi possível abrir o cardápio"));
  }
});

function renderPreview({ name, description, image, shareUrl, menuUrl }) {
  const title = `${name} | Cardápio digital`;
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(shareUrl)}"><link rel="icon" href="/logo.png">
<meta property="og:site_name" content="bq menu"><meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(name)}"><meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:secure_url" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(shareUrl)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(name)}">
<meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}">
<meta http-equiv="refresh" content="0;url=${escapeHtml(menuUrl)}">
</head><body><p>Abrindo o cardápio de ${escapeHtml(name)}...</p>
<script>location.replace(${safeJson(menuUrl)});</script>
<noscript><a href="${escapeHtml(menuUrl)}">Abrir cardápio</a></noscript></body></html>`;
}

function renderUnavailable(origin, message) {
  return renderPreview({
    name: "bq menu",
    description: message,
    image: `${origin}${FALLBACK_IMAGE}`,
    shareUrl: origin,
    menuUrl: `${origin}/cardapio.html`
  });
}

function requestOrigin(request) {
  const protocol = String(request.get("x-forwarded-proto") || request.protocol || "https").split(",")[0].trim();
  const host = String(request.get("x-forwarded-host") || request.get("host") || "bqmenu.bqsystems.com.br").split(",")[0].trim();
  return `${protocol === "http" ? "http" : "https"}://${host}`;
}

function absoluteHttpUrl(value, origin) {
  if (!value) return "";
  try {
    const url = new URL(String(value), origin);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

function safeDocumentId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 180 && !id.includes("/") ? id : "";
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function safeJson(value) {
  return JSON.stringify(String(value)).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
