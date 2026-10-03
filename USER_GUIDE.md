# User guide

## 1. Getting started
1. Register, verify your email (in development, links appear at `/dev/outbox`), sign in.
2. The setup wizard asks for the household name, region, currency and goals. Or load the labelled demo household to explore first.
3. Add accounts (Accounts), your income (Income), then record transactions or import a CSV.

## 2. Your finances and the household
The switch at the top of each page chooses **My Finances** (only what you own) or **Household Finances** (what members have shared). **Household, Comparison** shows members side by side using only shared figures.

Every record has a sharing setting: **Personal** (only you, not even administrators), **Household** (everyone, in the totals) or **Selected members**. Your defaults per record type are in Household, My sharing.

## 3. Inviting members
Household, Members, Invite by email. Choose Administrator (manages the household), Member (records and edits) or Read only. The invited person registers or signs in and accepts the link, then has their own private space.

## 4. Recording money
- **Income**: record gross and net separately. Reports about cash use net.
- **Expenses**: choose the account, who paid, and whose expense it is: yours, a member's, the household's, or split by percent or amounts. It is counted once.
- **Transfers** between accounts and **credit card payments** are not expenses.
- **Refunds** and **reimbursements** reduce the category they refund. **Settlements** between members only move who owes whom.
- Joint accounts belong to the household. Spending from them is household spending paid by nobody in particular.

## 4a. Vehicles
Add vehicles under Vehicles. When you record a fuel, insurance or repair expense, choose the vehicle in the form. Vehicles, Running costs then shows what each vehicle cost, the cost per kilometre, and the next maintenance due. Maintenance dates also appear on the Calendar and Dashboard. Only transactions you are allowed to see are counted.

## 5. Contributions and settling up
Household, Contributions. Pick an arrangement (independent, shared equally, income based, fixed amounts, custom), see what each member paid, their share and the net position, then record a settlement when someone pays someone back.

## 6. Planning
Budgets, Debts (payoff strategies), Goals, Net worth, Forecast (daily cash flow with listed assumptions), Simulator (what-if scenarios that never change your real data), Planner (mortgage, affordability, down payment).

## 7. Tax
Tax records per year, an estimate from the rules loaded for your region, and a clear split between tax actually deducted and estimated liability. It is an estimate only.

## 8. Reports, import and export
Reports: choose a report, scope and dates, then download PDF, Excel or CSV. Import: upload CSV, confirm the column mapping, review each row (duplicates are skipped), import, and undo whole batches if needed. Export any list from Import and export. Household, Data lets you download everything you own as JSON.

## 9. Alerts and documents
Alerts for due bills, budgets, low balances, renewals and unusual spending appear under Notifications and can be tuned in Household, Alerts. Attach receipts and statements to records; a file is only as visible as its record.

## 9a. Starting fresh
- **Demo data:** while you are looking at the demo household, a banner on every page offers **Remove demo and start fresh**. It deletes the demo household (and its demo vehicle), then takes you to set up your own.
- **Clear my records** (Household, Start fresh and data): permanently removes everything you own in this household so you can enter it again. Joint accounts, other members' records, categories and settings are not touched, and transfers into joint accounts are removed on both sides so balances stay correct. Vehicles are not affected.
- **Delete this household** (administrator, only when you are the only member): removes the household, its vehicles and records.
- Nobody can clear or delete another member's records.

## 9b. Each person keeps their own books
Everyone signs in with their own account. An administrator invites each person by email (Household, Members, Invite a member). If email is not set up, copy the link shown in the dialog (or use Get a new link next to a pending invitation) and send it yourself. The invited person registers or signs in with that same email address, accepts, and lands in the shared household. They should then choose what they share (Household, My sharing): everything shared, everything personal, or per type. From then on they enter their own accounts, income and spending as usual; Personal records are visible only to them, and the Household view and totals combine only what has been shared.

## 9c. Money tools
- **Auto rules** (Tools): "if the description contains costco, set the category to Groceries and add the tag bulk". Rules only fill empty fields, never override your choice, and run on new entries and on imports. Preview shows how many past entries a rule would catch; "Apply to past entries" back-fills uncategorised ones. Rules are personal unless an administrator makes them household-wide.
- **Tags and saved filters:** add comma-separated tags to any entry, filter by tag, see spending by tag in Expenses. On Transactions, "Save filter" keeps a filter for later. Saved filters are private to you.
- **Safe to spend** (Dashboard): cash in chequing and cash accounts minus bills and payments due before your next pay day. It is a guide: it cannot know about spending you have not recorded.
- **RRSP, TFSA, FHSA** (Wealth): enter the room from your CRA notice of assessment; contributions on your investment accounts are subtracted. Only you can see it. Limits shown are reference values for 2024 to 2026: confirm at canada.ca.
- **Pay day plan** (Money): split a paycheck into transfers to accounts and goals. Running it creates ordinary transfers, and a plan refuses to run twice for the same date unless you confirm.
- **Budget nudge:** saving an expense that takes a budget to 80 percent or more shows a short message.

## 10. Demo data
Demo records are labelled and can be removed in Household, Data, Remove demo data. This deletes only the demo household.
