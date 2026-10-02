// Default category tree and account helpers for new households. Jurisdiction neutral; users can add, rename and archive freely.
export interface CatSeed {
  name: string;
  essential?: boolean;
  system?: boolean;
  color?: string;
  children?: string[];
}
export const EXPENSE_CATEGORIES: CatSeed[] = [
  { name: "Housing", essential: true, color: "#185040", children: ["Mortgage", "Rent", "Property tax", "Condo fees", "Home maintenance", "Home insurance"] },
  { name: "Utilities", essential: true, color: "#9A7530", children: ["Electricity", "Natural gas", "Water", "Internet", "Mobile phone"] },
  { name: "Groceries", essential: true, color: "#385C70" },
  { name: "Restaurants", color: "#A83028" },
  { name: "Transportation", essential: true, color: "#6B7235", children: ["Fuel", "Vehicle maintenance", "Vehicle insurance", "Vehicle registration", "Parking and transit"] },
  { name: "Health", essential: true, color: "#57827D", children: ["Medical and dental", "Pharmacy", "Health insurance"] },
  { name: "Insurance", essential: true, color: "#464C48", children: ["Life insurance", "Disability insurance", "Tenant insurance", "Travel insurance"] },
  { name: "Childcare", essential: true, color: "#C27A4E" },
  { name: "Education", color: "#7A6A4F" },
  { name: "Clothing", color: "#8A5A44" },
  { name: "Entertainment", color: "#5E7F62" },
  { name: "Travel", color: "#4C6F85" },
  { name: "Personal care", color: "#A38B6D" },
  { name: "Subscriptions", color: "#6F6A8A".replace("#6F6A8A", "#7B6F57") },
  { name: "Taxes", essential: true, color: "#555B57" },
  { name: "Gifts and donations", color: "#B58A5A" },
  { name: "Interest and fees", essential: true, system: true, color: "#8C3A32" },
  { name: "Miscellaneous", color: "#74796F" },
];
export const INCOME_CATEGORIES: CatSeed[] = [
  { name: "Salary", color: "#185040" },
  { name: "Self-employment", color: "#2E6A57" },
  { name: "Business", color: "#3D7A66" },
  { name: "Rental income", color: "#9A7530" },
  { name: "Investment income", color: "#385C70" },
  { name: "Government benefits", color: "#6B7235" },
  { name: "Other income", color: "#74796F" },
];
export const INTEREST_CATEGORY = "Interest and fees";

export const DEBT_ACCOUNT_TYPE: Record<string, string> = { CREDIT_CARD: "CREDIT_CARD", LINE_OF_CREDIT: "LINE_OF_CREDIT", MORTGAGE: "MORTGAGE", PERSONAL_LOAN: "LOAN", VEHICLE_LOAN: "LOAN", STUDENT_LOAN: "LOAN", OTHER: "OTHER_LIABILITY" };
export const ACCOUNT_DEBT_TYPE: Record<string, string> = { CREDIT_CARD: "CREDIT_CARD", LINE_OF_CREDIT: "LINE_OF_CREDIT", MORTGAGE: "MORTGAGE", LOAN: "PERSONAL_LOAN", OTHER_LIABILITY: "OTHER" };
export const AVATAR_COLORS = ["#185040", "#9A7530", "#385C70", "#A83028", "#6B7235", "#57827D", "#C27A4E", "#464C48"];
