# AutoVault user guide

## 1. Account setup
1. **Register** with name, email and a strong password (≥10 characters). Tick the privacy statement.
2. Open the **verification email** and click the link, then sign in. (Self-hosting without SMTP? Links appear at `/dev/outbox` in development.)
3. A personal **household** is created for you automatically — rename it in *Settings → Household & sharing*.
4. In *Settings → Units & display* choose kilometres or miles, litres/gallons, fuel-economy unit, currency and time zone. Odometer data is stored in km and converted, so you can switch any time.

## 2. Adding vehicles
*My Vehicles → Add vehicle.* Start blank or from the **2015 BMW X3 28i (F25, N20)** starter profile. Enter the VIN and press **Decode VIN** (where available) to get *suggestions* — tick the fields you want; values you typed yourself are never overwritten. Choose the drivetrain so AWD/RWD-only items (transfer case, differentials) are included correctly. Enter the current odometer (or add it later).

The starter profile creates an **uncompleted checklist** — no fictional history. Its intervals are generic suggestions, **not BMW specifications**; BMW uses Condition Based Service, so follow your service indicator and owner's manual, and edit any interval.

## 3. Mileage
*Quick add → Update mileage* (or the vehicle's Odometer tab). Entries that go backwards are blocked; if the cluster was replaced or an old entry was a typo, tick **legitimate correction** (it is audited). You can also correct/delete manual readings and import a list. The tab shows average distance per month/year, projections and charts.

## 4. Maintenance schedules
*Maintenance* (all vehicles) or the vehicle's *Maintenance* tab. Statuses: **Up to date · Upcoming · Due soon · Due now · Overdue · Inspection required · Unknown history**. For items with *Unknown history*, click ✏ and enter when it was last done (no expense is created) — or just record a service. Each line says what the estimate is based on (your schedule / manufacturer data / your driving history / generic suggestion). Edit triggers (mileage, time, either, both, inspection, condition, one-time, recurring), thresholds, priority, enable/disable, or add custom schedules. Thresholds for “upcoming/due soon/overdue” are in Settings.

## 5. Recording maintenance
*Quick add → Log maintenance*, or press **Record** on any schedule to pre-fill the form (oil + filter are pre-selected together; untick what you didn't do). Add date, odometer, who did the work, parts and costs, then **upload the receipt**. Only items marked *completed* update their schedules; unrelated items are untouched. Drafts, scheduled and in-progress records don't affect schedules or expenses. Saving creates the expense and odometer reading and recalculates next due date and mileage. Duplicate submissions are detected.

## 6. Repairs & issues
*Quick add → Report a vehicle issue* the moment you notice a problem (photo, severity, symptoms). Move it through *Investigating → Diagnosed → Awaiting parts → Scheduled → In repair → Resolved/Monitoring/Closed*. Add **diagnostic trouble codes** — AutoVault explains what a generic code usually means but never treats it as a diagnosis. When fixed, **Convert to completed repair** to record cost, create the expense and resolve the issue. *Repairs & Issues* also shows cost history by component.

## 7. Parts & warranties
Tick **Track this part** when recording a service, or add parts manually. Replacing a component closes the old installation (with odometer) and starts a new one; *Component history* shows every battery, pad set or pump ever installed. Add vehicle/part warranties for expiry alerts.

## 8. Expenses, fuel & budgets
Everything that costs money lives under *Expenses*. Services and fuel create their expenses automatically; add insurance, registration, parking, tolls etc. manually. *Fuel* computes economy between full-tank fill-ups (tick “partial” when you didn't fill up; tick “missed a fill-up” to skip a gap). *Budgets* track monthly/annual maintenance spend with projection and notifications at 80 % / 100 %. *Reports & Analytics* shows cost per km/mile for maintenance-only, repair-only and total ownership, with the option to exclude financing, insurance or fuel — it only uses periods covered by odometer readings and tells you what it left out.

## 9. Reminders
*Reminders* lists everything due or coming due plus your own date/odometer reminders. A background job creates notifications at the offsets you choose (e.g. 1,000 km and 500 km before, on the due date, when overdue) — each stage once, never duplicated — whether or not you open the app. Choose in-app, email and push in *Settings → Notifications* (push works only where your browser supports it; on iPhone install the app first).

## 10. Documents & receipts
*Documents* stores PDFs and images (≤10 MB) with category, expiry date and links to services/expenses/repairs/parts. For receipts you can **Extract details**: the values are shown for you to check and edit — **nothing is saved as an expense until you confirm**.

## 11. Reports & exports
*Reports & Analytics → Reports & exports*: choose a report, vehicle and period, set the **privacy options** (hide VIN/plate, costs, provider names) and download PDF, CSV, Excel or JSON. The PDF service history is formatted for mechanics, dealers, insurers and buyers.

## 12. Sharing with family
*Settings → Household & sharing → Invite a family member.* Pick the vehicles and a level per vehicle — Owner, Co-owner, Maintenance manager (can add records, can't see costs unless allowed), Viewer. They accept the invitation after signing in with the invited email. Household administrators see everything; others only what you share. Remove access any time.

## 13. AI assistant
Ask “What was the cost of my last oil change?”, “How much have I spent on suspension repairs?”, “What records are missing?”. It answers only from your recorded data and says when something isn't recorded. Advice is advisory — check your manual.

## 14. Install & offline
Install from your browser menu (iPhone: Share → Add to Home Screen). Pages and records you've opened remain readable offline; mileage, fuel, expenses and services entered offline are kept as drafts and sync automatically (with duplicate protection). Review them from the banner.

## 15. Your data
*Settings → Privacy & data*: set sharing defaults, **download all your data (JSON)**, or **delete your account**.
