const link = sessionStorage.getItem("lastOrderLink");
const code = sessionStorage.getItem("lastOrderCode");
const params = new URLSearchParams(location.search);
const menuLink = document.querySelector("#order-menu-link");

if (code) {
  document.querySelector("#order-title").textContent = `Pedido ${code} registrado`;
}

if (link) {
  document.querySelector("#order-whatsapp-link").href = link;
} else {
  document.querySelector("#order-whatsapp-link").classList.add("hidden");
  document.querySelector("#order-summary").textContent = "Pedido registrado. Caso o link de WhatsApp nao apareca, volte ao cardapio e confira o WhatsApp do estabelecimento.";
}

if (menuLink && params.get("estabelecimento")) {
  menuLink.href = `cardapio.html?estabelecimento=${params.get("estabelecimento")}`;
}
