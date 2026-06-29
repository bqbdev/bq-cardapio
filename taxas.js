export function calculatePaymentFee(total, paymentMethod, fees = {}) {
  const value = Number(total || 0);
  const map = {
    "Cartao de credito": [fees.creditoPercentual, 0],
    "Cartao de debito": [fees.debitoPercentual, 0],
    PIX: [fees.pixPercentual, fees.pixFixo],
    Dinheiro: [fees.dinheiroPercentual, fees.dinheiroFixo]
  };
  const [percent = 0, fixed = 0] = map[paymentMethod] || [0, 0];
  return (value * Number(percent || 0) / 100) + Number(fixed || 0);
}
