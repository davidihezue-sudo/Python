// Reference data: maintenance categories and the SUGGESTED schedule library.
//
// ACCURACY POLICY: nothing here is a manufacturer requirement. Every interval is a generic starting point
// (sourceType = SUGGESTED) that the user can change, disable or replace with their own manufacturer figure.
// Items whose replacement is condition-driven carry no replacement interval, only an inspection cadence.
import type { Priority, TriggerType } from "@prisma/client";

export const CATEGORIES = [
  { key: "engine", name: "Engine", sortOrder: 1 },
  { key: "ignition", name: "Ignition", sortOrder: 2 },
  { key: "cooling", name: "Cooling", sortOrder: 3 },
  { key: "transmission", name: "Transmission", sortOrder: 4 },
  { key: "drivetrain", name: "Drivetrain", sortOrder: 5 },
  { key: "braking", name: "Braking", sortOrder: 6 },
  { key: "suspension_steering", name: "Suspension & Steering", sortOrder: 7 },
  { key: "electrical", name: "Electrical", sortOrder: 8 },
  { key: "climate", name: "Climate Control", sortOrder: 9 },
  { key: "tires_wheels", name: "Tires & Wheels", sortOrder: 10 },
  { key: "other", name: "Other", sortOrder: 11 },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];

export const GENERIC_SOURCE_NOTE = "Generic suggested interval — not a manufacturer requirement. Check your owner's manual and adjust.";

interface LibItem {
  key: string;
  category: CategoryKey;
  name: string;
  trigger: TriggerType;
  km?: number;
  months?: number;
  priority?: Priority;
  description?: string;
  instructions?: string;
  fuelTypes?: string[];
  drivetrains?: string[];
}

const ICE = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "OTHER"];
const SPARK = ["PETROL", "HYBRID", "PLUGIN_HYBRID", "OTHER"];

export const LIBRARY: LibItem[] = [
  // Engine
  { key: "engine_oil", category: "engine", name: "Engine oil", trigger: "MILEAGE_OR_TIME", km: 10000, months: 12, priority: "HIGH", fuelTypes: ICE, description: "Drain and refill engine oil with the grade/spec in your owner's manual." },
  { key: "oil_filter", category: "engine", name: "Oil filter", trigger: "MILEAGE_OR_TIME", km: 10000, months: 12, priority: "HIGH", fuelTypes: ICE, description: "Replace with every oil change." },
  { key: "engine_air_filter", category: "engine", name: "Engine air filter", trigger: "MILEAGE_OR_TIME", km: 30000, months: 24, priority: "NORMAL", fuelTypes: ICE },
  { key: "oil_leak_inspection", category: "engine", name: "Oil leaks inspection", trigger: "INSPECTION", months: 12, priority: "NORMAL", fuelTypes: ICE, description: "Check valve cover, oil pan, filter housing and seals for seepage." },
  { key: "engine_mounts", category: "engine", name: "Engine mounts", trigger: "INSPECTION", months: 24, priority: "NORMAL", fuelTypes: ICE },
  { key: "drive_belts", category: "engine", name: "Belts", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "Inspect serpentine/auxiliary belts for cracking, glazing and tension." },
  { key: "timing_chain_inspection", category: "engine", name: "Timing chain inspection", trigger: "INSPECTION", km: 60000, months: 24, priority: "NORMAL", fuelTypes: ICE, description: "Applicable to chain-driven engines: listen for rattle on cold start; check for timing-related fault codes." },
  // Ignition
  { key: "spark_plugs", category: "ignition", name: "Spark plugs", trigger: "MILEAGE", km: 60000, priority: "NORMAL", fuelTypes: SPARK, description: "Replacement intervals vary widely by plug type and engine (turbocharged engines are often shorter)." },
  { key: "ignition_coils", category: "ignition", name: "Ignition coils", trigger: "CONDITION", months: 12, priority: "NORMAL", fuelTypes: SPARK, description: "Replace when misfire codes or rough running indicate a failing coil." },
  { key: "ignition_wiring", category: "ignition", name: "Ignition wiring", trigger: "INSPECTION", months: 36, priority: "LOW", fuelTypes: SPARK },
  // Cooling
  { key: "coolant", category: "cooling", name: "Coolant", trigger: "MILEAGE_OR_TIME", km: 80000, months: 48, priority: "HIGH", description: "Coolant flush/refill with the correct type for your vehicle." },
  { key: "radiator", category: "cooling", name: "Radiator", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "water_pump", category: "cooling", name: "Water pump", trigger: "CONDITION", months: 12, priority: "HIGH", description: "Replace on evidence of leakage, noise or overheating (some designs are replaced preventatively with other cooling parts)." },
  { key: "thermostat", category: "cooling", name: "Thermostat", trigger: "CONDITION", months: 12, priority: "NORMAL", description: "Replace if the engine runs too hot/cold or related fault codes appear." },
  { key: "cooling_hoses", category: "cooling", name: "Cooling hoses", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "expansion_tank", category: "cooling", name: "Expansion tank", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "Check for hairline cracks, level and cap condition." },
  // Transmission
  { key: "transmission_fluid", category: "transmission", name: "Transmission fluid", trigger: "MILEAGE_OR_TIME", km: 80000, months: 60, priority: "HIGH", fuelTypes: ICE },
  { key: "transmission_filter", category: "transmission", name: "Transmission filter", trigger: "MILEAGE_OR_TIME", km: 80000, months: 60, priority: "NORMAL", fuelTypes: ICE, description: "Often replaced together with the pan/fluid service." },
  { key: "transmission_pan", category: "transmission", name: "Transmission pan", trigger: "INSPECTION", months: 24, priority: "NORMAL", fuelTypes: ICE, description: "Inspect for leaks; inspect/replace gasket during fluid service." },
  { key: "transmission_inspection", category: "transmission", name: "Transmission inspection", trigger: "INSPECTION", months: 12, priority: "NORMAL", fuelTypes: ICE },
  // Drivetrain
  { key: "front_differential", category: "drivetrain", name: "Front differential fluid (if equipped)", trigger: "MILEAGE_OR_TIME", km: 100000, months: 72, priority: "NORMAL", drivetrains: ["AWD", "FOUR_WD"] },
  { key: "rear_differential", category: "drivetrain", name: "Rear differential fluid", trigger: "MILEAGE_OR_TIME", km: 100000, months: 72, priority: "NORMAL", drivetrains: ["RWD", "AWD", "FOUR_WD"] },
  { key: "transfer_case", category: "drivetrain", name: "Transfer case fluid (if equipped)", trigger: "MILEAGE_OR_TIME", km: 100000, months: 72, priority: "NORMAL", drivetrains: ["AWD", "FOUR_WD"] },
  { key: "driveshaft", category: "drivetrain", name: "Driveshaft", trigger: "INSPECTION", months: 24, priority: "NORMAL", drivetrains: ["RWD", "AWD", "FOUR_WD"], description: "Check universal joints/flex discs for play and vibration." },
  { key: "center_support_bearing", category: "drivetrain", name: "Centre support bearing", trigger: "INSPECTION", months: 24, priority: "NORMAL", drivetrains: ["RWD", "AWD"], description: "Applicable to multi-piece driveshafts: look for cracked rubber and driveline vibration." },
  { key: "cv_joints", category: "drivetrain", name: "CV joints", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "Inspect boots for tears/grease leakage and listen for clicking on full-lock turns." },
  { key: "axles", category: "drivetrain", name: "Axles", trigger: "INSPECTION", months: 24, priority: "NORMAL" },
  // Braking
  { key: "brake_pads_front", category: "braking", name: "Front brake pads", trigger: "CONDITION", months: 12, priority: "CRITICAL", description: "Replace based on measured pad thickness / wear indicator; inspect at least yearly." },
  { key: "brake_pads_rear", category: "braking", name: "Rear brake pads", trigger: "CONDITION", months: 12, priority: "CRITICAL", description: "Replace based on measured pad thickness / wear indicator; inspect at least yearly." },
  { key: "brake_rotors_front", category: "braking", name: "Front brake rotors", trigger: "CONDITION", months: 12, priority: "HIGH", description: "Replace when below minimum thickness, warped or heavily scored." },
  { key: "brake_rotors_rear", category: "braking", name: "Rear brake rotors", trigger: "CONDITION", months: 12, priority: "HIGH", description: "Replace when below minimum thickness, warped or heavily scored." },
  { key: "brake_fluid", category: "braking", name: "Brake fluid", trigger: "TIME", months: 24, priority: "HIGH", description: "Brake fluid absorbs moisture over time; a time-based flush is widely recommended." },
  { key: "brake_hoses", category: "braking", name: "Brake hoses", trigger: "INSPECTION", months: 12, priority: "HIGH" },
  { key: "parking_brake", category: "braking", name: "Parking brake", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  // Suspension & steering
  { key: "front_suspension", category: "suspension_steering", name: "Front suspension", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "General inspection of front suspension components." },
  { key: "rear_suspension", category: "suspension_steering", name: "Rear suspension", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "General inspection of rear suspension components." },
  { key: "shocks_front", category: "suspension_steering", name: "Front shock absorbers", trigger: "CONDITION", months: 12, priority: "NORMAL" },
  { key: "shocks_rear", category: "suspension_steering", name: "Rear shock absorbers", trigger: "CONDITION", months: 12, priority: "NORMAL" },
  { key: "coil_springs", category: "suspension_steering", name: "Coil springs", trigger: "CONDITION", months: 24, priority: "NORMAL" },
  { key: "control_arms", category: "suspension_steering", name: "Control arms", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "ball_joints", category: "suspension_steering", name: "Ball joints", trigger: "INSPECTION", months: 12, priority: "HIGH" },
  { key: "tie_rods", category: "suspension_steering", name: "Tie rods", trigger: "INSPECTION", months: 12, priority: "HIGH" },
  { key: "bushings", category: "suspension_steering", name: "Bushings", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "wheel_bearings", category: "suspension_steering", name: "Wheel bearings", trigger: "INSPECTION", months: 12, priority: "HIGH", description: "Listen for humming that changes with speed; check for play." },
  { key: "power_steering", category: "suspension_steering", name: "Power steering system (if equipped)", trigger: "INSPECTION", months: 12, priority: "NORMAL", description: "Hydraulic systems: check fluid level/leaks. Electric systems: check for warnings and play." },
  // Electrical
  { key: "battery", category: "electrical", name: "Battery", trigger: "INSPECTION", months: 12, priority: "HIGH", description: "Load/health test annually; replace when it fails the test." },
  { key: "alternator", category: "electrical", name: "Alternator", trigger: "CONDITION", months: 12, priority: "NORMAL" },
  { key: "starter", category: "electrical", name: "Starter", trigger: "CONDITION", months: 12, priority: "NORMAL" },
  { key: "sensors", category: "electrical", name: "Sensors", trigger: "CONDITION", months: 24, priority: "LOW" },
  { key: "lighting", category: "electrical", name: "Lighting", trigger: "INSPECTION", months: 6, priority: "NORMAL" },
  { key: "wiring", category: "electrical", name: "Wiring", trigger: "INSPECTION", months: 24, priority: "LOW" },
  // Climate
  { key: "cabin_air_filter", category: "climate", name: "Cabin air filter", trigger: "MILEAGE_OR_TIME", km: 20000, months: 12, priority: "NORMAL" },
  { key: "ac_inspection", category: "climate", name: "Air conditioning inspection", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "refrigerant_service", category: "climate", name: "Refrigerant service", trigger: "CONDITION", months: 24, priority: "LOW", description: "Service when cooling performance drops." },
  { key: "ac_compressor", category: "climate", name: "A/C compressor", trigger: "CONDITION", months: 24, priority: "LOW" },
  { key: "blower_motor", category: "climate", name: "Blower motor", trigger: "CONDITION", months: 24, priority: "LOW" },
  // Tires & wheels
  { key: "tire_rotation", category: "tires_wheels", name: "Tire rotation", trigger: "MILEAGE_OR_TIME", km: 10000, months: 6, priority: "NORMAL" },
  { key: "tire_balancing", category: "tires_wheels", name: "Tire balancing", trigger: "CONDITION", months: 12, priority: "LOW" },
  { key: "wheel_alignment", category: "tires_wheels", name: "Wheel alignment", trigger: "INSPECTION", months: 12, priority: "NORMAL" },
  { key: "seasonal_tire_change", category: "tires_wheels", name: "Seasonal tire change", trigger: "TIME", months: 6, priority: "NORMAL", description: "Swap summer/winter sets. Tip: use a Recurring rule with an anchor date if you change on fixed dates." },
  { key: "tire_replacement", category: "tires_wheels", name: "Tires", trigger: "CONDITION", months: 12, priority: "HIGH", description: "Replace on tread depth / age / damage. Check tread and tire age at least yearly." },
  { key: "tire_pressure_monitoring", category: "tires_wheels", name: "Tire pressure monitoring", trigger: "INSPECTION", months: 3, priority: "NORMAL", description: "Check pressures monthly and verify TPMS sensors work." },
  // Other
  { key: "wipers", category: "other", name: "Windshield wipers", trigger: "TIME", months: 12, priority: "LOW" },
  { key: "washer_fluid", category: "other", name: "Washer fluid", trigger: "INSPECTION", months: 3, priority: "LOW" },
  { key: "exhaust", category: "other", name: "Exhaust", trigger: "INSPECTION", months: 12, priority: "NORMAL", fuelTypes: ICE },
  { key: "emissions_inspection", category: "other", name: "Emissions inspection", trigger: "INSPECTION", months: 24, priority: "NORMAL", description: "Whether and how often this is required depends on your jurisdiction." },
  { key: "body_inspection", category: "other", name: "Body inspection", trigger: "INSPECTION", months: 12, priority: "LOW" },
  { key: "general_inspection", category: "other", name: "General vehicle inspection", trigger: "INSPECTION", km: 20000, months: 12, priority: "NORMAL" },
];

export interface VehicleTemplate {
  key: string;
  label: string;
  note: string;
  vehicle: Record<string, unknown>;
  scheduleKeys: string[];
  sourceNote: string;
}

export const TEMPLATES: VehicleTemplate[] = [
  {
    key: "bmw-x3-28i-f25",
    label: "2015 BMW X3 28i (F25, N20 2.0L turbo)",
    note: "Starter profile. Every detail is editable. No service history is pre-filled and the intervals below are generic suggestions, NOT BMW specifications — BMW uses Condition Based Service (CBS), so follow your vehicle's service indicator, owner's manual and BMW guidance.",
    vehicle: {
      make: "BMW",
      model: "X3",
      year: 2015,
      trim: "28i",
      generation: "F25",
      engineType: "N20 2.0L turbocharged petrol",
      engineDisplacementL: 2.0,
      engineCode: "N20",
      fuelType: "PETROL",
      transmission: "AUTOMATIC",
      drivetrain: null,
      bodyType: "SUV",
      market: "Canada",
      currency: "CAD",
    },
    scheduleKeys: [
      "engine_oil", "oil_filter", "engine_air_filter", "cabin_air_filter", "spark_plugs", "ignition_coils", "brake_fluid", "coolant", "water_pump", "thermostat",
      "transmission_fluid", "transmission_filter", "transmission_pan", "transfer_case", "front_differential", "rear_differential",
      "brake_pads_front", "brake_pads_rear", "brake_rotors_front", "brake_rotors_rear", "brake_hoses", "battery", "alternator", "starter",
      "front_suspension", "rear_suspension", "coil_springs", "shocks_front", "shocks_rear", "control_arms", "ball_joints", "wheel_bearings",
      "driveshaft", "center_support_bearing", "cv_joints", "tire_replacement", "wheel_alignment", "wipers", "ac_inspection", "general_inspection",
    ],
    sourceNote: "Generic starting point — NOT a BMW specification. BMW uses Condition Based Service; confirm with your owner's manual / dealer.",
  },
];

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "item";
}

export function libraryAppliesTo(item: LibItem, v: { fuelType: string; drivetrain: string | null }) {
  if (item.fuelTypes && !item.fuelTypes.includes(v.fuelType)) return false;
  if (item.drivetrains && v.drivetrain && !item.drivetrains.includes(v.drivetrain)) return false;
  return true;
}
