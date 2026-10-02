// Generic OBD-II diagnostic trouble code (DTC) reference.
// IMPORTANT: descriptions are the *generic* SAE J2012 meaning only. They are not a diagnosis; the true cause is vehicle-specific.
export interface DtcInfo {
  code: string;
  system: "Powertrain" | "Body" | "Chassis" | "Network";
  scope: "GENERIC" | "MANUFACTURER_SPECIFIC" | "UNKNOWN_FORMAT";
  subsystem?: string;
  description?: string;
  known: boolean;
  disclaimer: string;
}

const KNOWN: Record<string, string> = {
  P0016: "Crankshaft Position – Camshaft Position Correlation (Bank 1 Sensor A)",
  P0087: "Fuel Rail/System Pressure – Too Low",
  P0101: "Mass or Volume Air Flow Circuit Range/Performance",
  P0102: "Mass or Volume Air Flow Circuit Low Input",
  P0103: "Mass or Volume Air Flow Circuit High Input",
  P0106: "Manifold Absolute Pressure/Barometric Pressure Circuit Range/Performance",
  P0113: "Intake Air Temperature Sensor Circuit High",
  P0116: "Engine Coolant Temperature Circuit Range/Performance",
  P0117: "Engine Coolant Temperature Circuit Low",
  P0118: "Engine Coolant Temperature Circuit High",
  P0121: "Throttle/Pedal Position Sensor A Circuit Range/Performance",
  P0128: "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
  P0130: "O2 Sensor Circuit (Bank 1 Sensor 1)",
  P0133: "O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)",
  P0135: "O2 Sensor Heater Circuit (Bank 1 Sensor 1)",
  P0171: "System Too Lean (Bank 1)",
  P0172: "System Too Rich (Bank 1)",
  P0174: "System Too Lean (Bank 2)",
  P0175: "System Too Rich (Bank 2)",
  P0201: "Injector Circuit/Open – Cylinder 1",
  P0202: "Injector Circuit/Open – Cylinder 2",
  P0203: "Injector Circuit/Open – Cylinder 3",
  P0204: "Injector Circuit/Open – Cylinder 4",
  P0234: "Turbocharger/Supercharger Overboost Condition",
  P0299: "Turbocharger/Supercharger Underboost",
  P0300: "Random/Multiple Cylinder Misfire Detected",
  P0301: "Cylinder 1 Misfire Detected",
  P0302: "Cylinder 2 Misfire Detected",
  P0303: "Cylinder 3 Misfire Detected",
  P0304: "Cylinder 4 Misfire Detected",
  P0305: "Cylinder 5 Misfire Detected",
  P0306: "Cylinder 6 Misfire Detected",
  P0325: "Knock Sensor 1 Circuit (Bank 1 or Single Sensor)",
  P0335: "Crankshaft Position Sensor A Circuit",
  P0340: "Camshaft Position Sensor A Circuit (Bank 1 or Single Sensor)",
  P0341: "Camshaft Position Sensor A Circuit Range/Performance",
  P0351: "Ignition Coil A Primary/Secondary Circuit",
  P0352: "Ignition Coil B Primary/Secondary Circuit",
  P0353: "Ignition Coil C Primary/Secondary Circuit",
  P0354: "Ignition Coil D Primary/Secondary Circuit",
  P0401: "Exhaust Gas Recirculation Flow Insufficient Detected",
  P0420: "Catalyst System Efficiency Below Threshold (Bank 1)",
  P0430: "Catalyst System Efficiency Below Threshold (Bank 2)",
  P0440: "Evaporative Emission System",
  P0442: "Evaporative Emission System Leak Detected (Small Leak)",
  P0446: "Evaporative Emission System Vent Control Circuit",
  P0455: "Evaporative Emission System Leak Detected (Gross Leak)",
  P0456: "Evaporative Emission System Leak Detected (Very Small Leak)",
  P0500: "Vehicle Speed Sensor A",
  P0505: "Idle Control System",
  P0562: "System Voltage Low",
  P0563: "System Voltage High",
  P0571: "Brake Switch A Circuit",
  P0600: "Serial Communication Link",
  P0606: "Control Module Processor",
  P0700: "Transmission Control System (MIL Request)",
  P0715: "Input/Turbine Speed Sensor Circuit",
  P0730: "Incorrect Gear Ratio",
  P0741: "Torque Converter Clutch Circuit Performance or Stuck Off",
  C0035: "Left Front Wheel Speed Sensor Circuit",
  C0040: "Right Front Wheel Speed Sensor Circuit",
  C0045: "Left Rear Wheel Speed Sensor Circuit",
  C0050: "Right Rear Wheel Speed Sensor Circuit",
  U0100: "Lost Communication With ECM/PCM A",
  U0101: "Lost Communication With TCM",
  U0121: "Lost Communication With Anti-Lock Brake System (ABS) Control Module",
  U0140: "Lost Communication With Body Control Module",
};

const SUBSYSTEM_P: Record<string, string> = {
  "1": "Fuel and air metering",
  "2": "Fuel and air metering (injector circuit)",
  "3": "Ignition system or misfire",
  "4": "Auxiliary emission controls",
  "5": "Vehicle speed, idle control and auxiliary inputs",
  "6": "Computer and output circuits",
  "7": "Transmission",
  "8": "Transmission",
  "9": "Transmission",
  "0": "Fuel and air metering and auxiliary emission controls",
};

export const DISCLAIMER =
  "This is the generic industry meaning of the code only. It is not a diagnosis - the same code can have several causes and the correct fix is vehicle-specific. Confirm with a qualified technician.";

export function normalizeDtc(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function lookupDtc(rawCode: string): DtcInfo {
  const code = normalizeDtc(rawCode);
  const m = /^([PBCU])([0-3])([0-9A-F])([0-9A-F]{2})$/.exec(code);
  if (!m) {
    // BMW and other makers also use 4-hex-digit fault memory codes (e.g. 2A87) that this tool cannot decode.
    const manufacturerHex = /^[0-9A-F]{4,6}$/.test(code);
    return {
      code,
      system: "Powertrain",
      scope: manufacturerHex ? "MANUFACTURER_SPECIFIC" : "UNKNOWN_FORMAT",
      known: false,
      description: undefined,
      disclaimer: manufacturerHex
        ? "This looks like a manufacturer-specific fault-memory code (for example BMW's hexadecimal codes). It cannot be interpreted generically - use the manufacturer's diagnostic tooling or a specialist."
        : "This does not look like a standard OBD-II code (expected a letter P/B/C/U followed by four characters, e.g. P0301). You can still store it with your own notes.",
    };
  }
  const [, letter, d2, d3] = m;
  const system = ({ P: "Powertrain", B: "Body", C: "Chassis", U: "Network" } as const)[letter as "P" | "B" | "C" | "U"];
  let scope: DtcInfo["scope"];
  if (letter === "P") scope = d2 === "0" || d2 === "2" ? "GENERIC" : d2 === "1" ? "MANUFACTURER_SPECIFIC" : parseInt(m[3] + m[4], 16) >= 0x40 && d2 === "3" ? "GENERIC" : "MANUFACTURER_SPECIFIC";
  else scope = d2 === "0" || d2 === "3" ? "GENERIC" : "MANUFACTURER_SPECIFIC";
  const description = KNOWN[code];
  return {
    code,
    system,
    scope,
    subsystem: letter === "P" ? SUBSYSTEM_P[d3] : undefined,
    description,
    known: !!description,
    disclaimer:
      scope === "MANUFACTURER_SPECIFIC"
        ? "This is a manufacturer-specific code: its meaning differs between makes. Look it up for your exact vehicle. " + DISCLAIMER
        : description
          ? DISCLAIMER
          : "This is a standard-format code that is not in Family Finance Hub's built-in reference. " + DISCLAIMER,
  };
}
