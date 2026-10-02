// VIN validation (ISO 3779 / FMVSS 115 check digit).
const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(v: string): string {
  return v.replace(/[\s-]/g, "").toUpperCase();
}

export interface VinCheck {
  valid: boolean;
  formatOk: boolean;
  checkDigitOk: boolean | null;
  message: string;
}

export function checkVin(raw: string): VinCheck {
  const vin = normalizeVin(raw);
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return { valid: false, formatOk: false, checkDigitOk: null, message: "A VIN is 17 characters (letters and digits, excluding I, O and Q)." };
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const val = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += val * WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? "X" : String(rem);
  const ok = vin[8] === expected;
  return {
    valid: true,
    formatOk: true,
    checkDigitOk: ok,
    message: ok ? "VIN format and check digit are valid." : "VIN format is valid but the check digit does not match (some non-North-American VINs do not use it). Please verify.",
  };
}
