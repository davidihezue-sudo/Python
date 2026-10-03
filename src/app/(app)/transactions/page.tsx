"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { NeedsHousehold, PageHeader, ViewNote } from "@/components/finance/ui";
import { TransactionList } from "@/components/finance/transaction-list";

export default function TransactionsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const sp = useSearchParams();
  const initial = { view: sp.get("view") ?? "all", categoryIds: sp.get("categoryIds") ?? "", from: sp.get("from") ?? "", to: sp.get("to") ?? "", accountId: sp.get("accountId") ?? "", vehicleId: sp.get("vehicleId") ?? "", tag: sp.get("tag") ?? "", member: sp.get("member") ?? "", types: sp.get("types") ?? "" };
  return (
    <div>
      <PageHeader eyebrow="Ledger" title="Transactions" description="Every income, expense, transfer, refund and adjustment, with who owns it, who paid and who entered it." />
      <TransactionList initial={initial} focus={sp.get("focus")} />
    </div>
  );
}
