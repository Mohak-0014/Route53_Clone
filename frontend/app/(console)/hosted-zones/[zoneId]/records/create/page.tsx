"use client";

import { use } from "react";
import { RecordFormPage } from "@/components/records/RecordFormPage";

export default function CreateRecordPage({ params }: { params: Promise<{ zoneId: string }> }) {
  const { zoneId } = use(params);
  return <RecordFormPage zoneId={zoneId} />;
}
