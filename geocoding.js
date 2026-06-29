export function establishmentAddressFromForm(form) {
  return [
    form.elements.estabelecimentoEndereco?.value,
    form.elements.estabelecimentoNumero?.value,
    form.elements.estabelecimentoBairro?.value,
    form.elements.cidade?.value,
    form.elements.estabelecimentoCep?.value,
    "Brasil"
  ].filter(Boolean).join(", ");
}

export async function geocodeAddress(address) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) throw new Error("Informe um endereço completo.");
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
    q: cleanAddress
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("Não foi possível consultar o endereço.");
  const results = await response.json();
  if (!results.length) throw new Error("Endereço não encontrado. Confira rua, número, bairro e cidade.");
  return {
    latitude: Number(results[0].lat),
    longitude: Number(results[0].lon),
    enderecoEncontrado: results[0].display_name || cleanAddress
  };
}

export async function fillCoordinatesFromAddress(form) {
  const result = await geocodeAddress(establishmentAddressFromForm(form));
  form.elements.estabelecimentoLatitude.value = result.latitude.toFixed(6);
  form.elements.estabelecimentoLongitude.value = result.longitude.toFixed(6);
  return result;
}
