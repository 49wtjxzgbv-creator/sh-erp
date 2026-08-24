'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFinanceDocuments, useCustomerOrderFinanceDocuments } from '@/lib/hooks/use-finance';
import { formatMoney } from '@/lib/finance-format';
import type { DocumentPaymentStatus } from '@/lib/api-client/finance';
import { DocumentFormDialog, type FinanceKind } from './document-form';
import { DocumentDrawer } from './document-drawer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type { FinanceKind };

const DOCUMENT_STATUS_VARIANT: Record<DocumentPaymentStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  NO_AMOUNT: 'outline',
  UNPAID: 'secondary',
  PARTIAL: 'warning',
  PAID: 'success',
};

/** Document list + create dialog — kind-parametrized replacement for the duplicated DocumentsPanel in the PO-Finance and CustomerOrder-Finance pages, also reused inline per linked-PO card. */
export function DocumentsPanel({
  kind,
  ownerId,
  canManage,
  defaultSupplierId,
  title,
}: {
  kind: FinanceKind;
  ownerId: string;
  canManage: boolean;
  defaultSupplierId?: string;
  title?: string;
}) {
  const t = useTranslations('finance');
  const poDocuments = useFinanceDocuments(kind === 'purchase-order' ? ownerId : undefined);
  const coDocuments = useCustomerOrderFinanceDocuments(kind === 'customer-order' ? ownerId : undefined);
  const documents = kind === 'purchase-order' ? poDocuments.data : coDocuments.data;
  const [openDocumentId, setOpenDocumentId] = useState<string | undefined>();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title ?? t('documents')}</CardTitle>
        {canManage && <DocumentFormDialog kind={kind} ownerId={ownerId} defaultSupplierId={defaultSupplierId} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {(documents?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}
        {documents?.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setOpenDocumentId(doc.id)}
            className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors hover:border-primary/50"
          >
            <div>
              <div className="font-medium">{doc.documentNumber || t(`documentType${doc.documentType}`)}</div>
              <div className="text-xs text-muted-foreground">
                {t(`documentType${doc.documentType}`)} · {doc.counterparty?.name}
                {doc.documentDate && ` · ${new Date(doc.documentDate).toLocaleDateString()}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {doc.amount && <span>{formatMoney(Number(doc.amount), doc.currency)}</span>}
              <Badge variant={DOCUMENT_STATUS_VARIANT[doc.paymentStatus]}>
                {doc.paymentStatus === 'NO_AMOUNT' ? t('documentPaymentStatusNO_AMOUNT') : t(`paymentStatus${doc.paymentStatus}`)}
              </Badge>
            </div>
          </button>
        ))}
      </CardContent>
      <DocumentDrawer
        kind={kind}
        ownerId={ownerId}
        documentId={openDocumentId}
        open={Boolean(openDocumentId)}
        onOpenChange={(o) => !o && setOpenDocumentId(undefined)}
        canManage={canManage}
      />
    </Card>
  );
}
