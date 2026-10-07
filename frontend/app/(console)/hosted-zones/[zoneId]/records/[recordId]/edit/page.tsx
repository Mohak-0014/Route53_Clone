"use client";

import { use } from "react";
import { RecordFormPage } from "@/components/records/RecordFormPage";

export default function EditRecordPage({ params }: { params: Promise<{ zoneId: string; recordId: string }> }) {
  const { zoneId, recordId } = use(params);
  return <RecordFormPage zoneId={zoneId} recordId={recordId} />;
}
