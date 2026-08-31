import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { Customer } from './customers';

/**
 * Typed wrappers for backend/src/modules/quotations/ (QuotationsController,
 * QuotationTemplatesController). Field shapes copied verbatim from
 * dto/quotation.dto.ts, dto/quotation-template.dto.ts, and schema.prisma's
 * Quotation/QuotationVersion/QuotationVersionItem/QuotationTemplate models.
 *
 * Money/percent/qty fields are DecimalString (see decimal.ts) on every
 * QuotationVersionItem, same as everywhere else Prisma Decimal columns
 * cross the wire. `costSnapshot`/`basePriceSnapshot`/`pricingPercent` come
 * back `null` for a role without `quotations:view-margin` — see
 * QuotationsService#findOne's own comment; the UI must treat `null` there
 * as "hidden", not "zero".
 */

export type QuotationStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED';
export type QuotationItemKind = 'ASSEMBLY' | 'PRODUCT' | 'SERVICE' | 'DELIVERY' | 'INSTALLATION' | 'CUSTOM';
export type PricingSource = 'BASE_PRICE' | 'MARKUP_PERCENT' | 'COST_PLUS_MARGIN' | 'LABOR_MARKUP_PERCENT' | 'LABOR_COST_PLUS_MARGIN' | 'CUSTOM';

export interface QuotationVersionItem {
  id: string;
  companyId: string;
  quotationVersionId: string;
  sortOrder: number;
  kind: QuotationItemKind;
  assemblyId: string | null;
  productId: string | null;
  nameSnapshot: string;
  descriptionSnapshot: string | null;
  quantity: DecimalString;
  unit: string;
  pricingSource: PricingSource;
  /** null when hidden (no quotations:view-margin) OR genuinely not applicable to this pricing method. */
  costSnapshot: DecimalString | null;
  basePriceSnapshot: DecimalString | null;
  pricingPercent: DecimalString | null;
  unitPrice: DecimalString;
  currency: string;
  discountPercent: DecimalString;
  discountAmount: DecimalString;
  subtotal: DecimalString;
  total: DecimalString;
  belowCostApproved: boolean;
  belowCostApprovedById: string | null;
}

export interface QuotationTemplateSnapshot {
  accentColor: string | null;
  printLogoFileId: string | null;
  headerText: string | null;
  footerText: string | null;
  visibleBlocks: Record<string, boolean>;
}

export interface QuotationVersion {
  id: string;
  companyId: string;
  quotationId: string;
  versionNumber: number;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  validUntil: string | null;
  currency: string;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  installationTerms: string | null;
  notes: string | null;
  subtotal: DecimalString;
  discountAmount: DecimalString;
  total: DecimalString;
  templateId: string | null;
  templateSnapshot: QuotationTemplateSnapshot | null;
  companySnapshot: { name: string; companyDetailsText: string | null } | null;
  pdfFileId: string | null;
  createdById: string;
  createdAt: string;
  /** Present on Quotation.currentVersion/versionHistory (findOne, and every action that re-returns the full quotation via findOne — create/saveItems/send/etc.). Absent on the bare updateQuotationTerms() response, which returns the raw QuotationVersion row only — re-fetch via useQuotation() for the item list. */
  items?: QuotationVersionItem[];
}

export interface Quotation {
  id: string;
  companyId: string;
  number: string;
  customerId: string;
  status: QuotationStatus;
  duplicatedFromId: string | null;
  convertedCustomerOrderId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Present on findOne only. */
  customer?: Customer;
  currentVersion?: QuotationVersion;
  versionHistory?: QuotationVersion[];
}

export interface QuotationListItem {
  id: string;
  number: string;
  status: QuotationStatus;
  customerId: string;
  customerName: string;
  createdById: string;
  createdAt: string;
  total: number;
  currency: string;
  validUntil: string | null;
  /** Computed, never persisted — true only for a SENT/VIEWED quotation whose validUntil has passed (QuotationsService#isExpired). */
  isExpired: boolean;
}

export interface CreateQuotationInput {
  customerId: string;
  validUntil?: string;
  currency?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  installationTerms?: string;
  notes?: string;
  templateId?: string;
}

export type UpdateQuotationVersionInput = Partial<CreateQuotationInput>;

export interface QuotationItemInput {
  kind: QuotationItemKind;
  assemblyId?: string;
  productId?: string;
  nameSnapshot?: string;
  descriptionSnapshot?: string;
  quantity: number;
  unit?: string;
  pricingSource: PricingSource;
  pricingPercent?: number;
  customUnitPrice?: number;
  discountPercent?: number;
  discountAmountOverride?: number;
}

export interface QueryQuotationsInput {
  status?: QuotationStatus;
  customerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedQuotations {
  items: QuotationListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ConvertToOrderResult {
  customerOrderId: string;
  /** Non-fatal — a skipped (deleted) Assembly line, or a non-ASSEMBLY line folded into deliveryCost/otherCost. Never means the conversion failed. */
  warnings: string[];
}

export function queryQuotations(query: QueryQuotationsInput = {}): Promise<PaginatedQuotations> {
  return apiClient.get<PaginatedQuotations>('quotations', { query: query as Record<string, string | number> });
}
export function getQuotation(id: string): Promise<Quotation> {
  return apiClient.get<Quotation>(`quotations/${id}`);
}
export function createQuotation(dto: CreateQuotationInput): Promise<Quotation> {
  return apiClient.post<Quotation>('quotations', dto);
}
export function updateQuotationTerms(id: string, dto: UpdateQuotationVersionInput): Promise<QuotationVersion> {
  return apiClient.patch<QuotationVersion>(`quotations/${id}/terms`, dto);
}
export function saveQuotationItems(id: string, items: QuotationItemInput[]): Promise<Quotation> {
  return apiClient.patch<Quotation>(`quotations/${id}/items`, { items });
}
export function approveBelowCost(id: string, itemId: string): Promise<QuotationVersionItem> {
  return apiClient.post<QuotationVersionItem>(`quotations/${id}/items/${itemId}/approve-below-cost`);
}
export function sendQuotation(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/send`);
}
export function createNewQuotationVersion(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/new-version`);
}
export function duplicateQuotation(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/duplicate`);
}
export function deleteQuotation(id: string): Promise<Quotation> {
  return apiClient.delete<Quotation>(`quotations/${id}`);
}
export function markQuotationViewed(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/view`);
}
export function acceptQuotation(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/accept`);
}
export function rejectQuotation(id: string): Promise<Quotation> {
  return apiClient.post<Quotation>(`quotations/${id}/reject`);
}
export function convertQuotationToOrder(id: string): Promise<ConvertToOrderResult> {
  return apiClient.post<ConvertToOrderResult>(`quotations/${id}/convert-to-order`);
}
/** §8: same renderer as the stored PDF — always reflects the CURRENT version's saved state, DRAFT or locked. */
export function getQuotationPreviewHtml(id: string): Promise<{ html: string }> {
  return apiClient.get<{ html: string }>(`quotations/${id}/preview`);
}

export interface QuotationTemplate {
  id: string;
  companyId: string;
  name: string;
  isDefault: boolean;
  accentColor: string | null;
  printLogoFileId: string | null;
  companyDetailsText: string | null;
  headerText: string | null;
  footerText: string | null;
  visibleBlocks: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateQuotationTemplateInput {
  name: string;
  isDefault?: boolean;
  accentColor?: string;
  printLogoFileId?: string;
  companyDetailsText?: string;
  headerText?: string;
  footerText?: string;
  visibleBlocks?: Record<string, boolean>;
}

export type UpdateQuotationTemplateInput = Partial<CreateQuotationTemplateInput>;

export function queryQuotationTemplates(): Promise<QuotationTemplate[]> {
  return apiClient.get<QuotationTemplate[]>('quotation-templates');
}
export function getQuotationTemplate(id: string): Promise<QuotationTemplate> {
  return apiClient.get<QuotationTemplate>(`quotation-templates/${id}`);
}
export function createQuotationTemplate(dto: CreateQuotationTemplateInput): Promise<QuotationTemplate> {
  return apiClient.post<QuotationTemplate>('quotation-templates', dto);
}
export function updateQuotationTemplate(id: string, dto: UpdateQuotationTemplateInput): Promise<QuotationTemplate> {
  return apiClient.patch<QuotationTemplate>(`quotation-templates/${id}`, dto);
}
export function deleteQuotationTemplate(id: string): Promise<QuotationTemplate> {
  return apiClient.delete<QuotationTemplate>(`quotation-templates/${id}`);
}
