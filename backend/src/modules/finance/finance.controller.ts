import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { FinanceService } from './finance.service';
import { CreatePurchaseOrderDocumentDto, QueryFinancePurchaseOrdersDto, UpdatePurchaseOrderDocumentDto } from './dto/finance-document.dto';
import { CreatePurchaseOrderPaymentDto, UpdatePurchaseOrderPaymentDto } from './dto/finance-payment.dto';
import { CreatePurchaseOrderExpenseDto, UpdatePurchaseOrderExpenseDto } from './dto/finance-expense.dto';
import { CreateCustomerOrderDocumentDto, QueryFinanceCustomerOrdersDto, UpdateCustomerOrderDocumentDto } from './dto/finance-customer-order-document.dto';
import { CreateCustomerOrderExpenseDto, UpdateCustomerOrderExpenseDto } from './dto/finance-customer-order-expense.dto';

@ApiTags('finance')
@Controller({ path: 'finance', version: '1' })
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('purchase-orders')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: '/finance landing page — every PO with its six-metric summary and derived payment status, paginated/filterable.' })
  async listPurchaseOrders(@CurrentUser() user: RequestUser, @Query() query: QueryFinancePurchaseOrdersDto) {
    return this.financeService.listPurchaseOrdersWithSummary(user, query);
  }

  @Get('purchase-orders/:purchaseOrderId/summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Six-metric financial summary for one PO (goods cost, additional expenses, actual cost, total documents, paid, unpaid per documents).' })
  async getSummary(@CurrentUser() user: RequestUser, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.financeService.getSummary(user, purchaseOrderId);
  }

  @Get('purchase-orders/:purchaseOrderId/documents')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'List financial documents attached to this PO, each with a derived payment status.' })
  async listDocuments(@CurrentUser() user: RequestUser, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.financeService.listDocuments(user, purchaseOrderId);
  }

  @Post('purchase-orders/:purchaseOrderId/documents')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Create a financial document (metadata only) on this PO. Attach the actual file afterwards via the normal files API — domain FINANCE_DOCUMENT, entityType "PurchaseOrderDocument", entityId = this document\'s id.' })
  async createDocument(
    @CurrentUser() user: RequestUser,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: CreatePurchaseOrderDocumentDto,
  ) {
    return this.financeService.createDocument(user, purchaseOrderId, dto);
  }

  @Get('documents/:id')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'One document with its counterparty, payments, and derived payment status.' })
  async getDocument(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.financeService.getDocument(user, id);
  }

  @Patch('documents/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit a document\'s metadata. The amount cannot be cleared once payments have been recorded against it.' })
  async updateDocument(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDocumentDto) {
    return this.financeService.updateDocument(user, id, dto);
  }

  @Delete('documents/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete a document — its payments cascade with it; any Expense that cited it as its confirming document keeps existing with documentId cleared.' })
  async deleteDocument(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deleteDocument(user, id);
    return { ok: true };
  }

  @Post('documents/:id/payments')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Record a payment against a document. Rejected if the document has no amount, or if the payment (same currency as the document) would exceed its remaining balance.' })
  async addPayment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CreatePurchaseOrderPaymentDto) {
    return this.financeService.addPayment(user, id, dto);
  }

  @Patch('payments/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit a payment. Same remaining-balance rule as recording one, excluding the payment being edited from its own "already paid" sum.' })
  async updatePayment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderPaymentDto) {
    return this.financeService.updatePayment(user, id, dto);
  }

  @Delete('payments/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete a payment.' })
  async deletePayment(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deletePayment(user, id);
    return { ok: true };
  }

  @Get('purchase-orders/:purchaseOrderId/expenses')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'List additional-cost expenses on this PO (never includes goods cost — that always comes from the PO\'s own items).' })
  async listExpenses(@CurrentUser() user: RequestUser, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.financeService.listExpenses(user, purchaseOrderId);
  }

  @Post('purchase-orders/:purchaseOrderId/expenses')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Record an additional-cost expense on this PO, optionally linked to its confirming document.' })
  async createExpense(
    @CurrentUser() user: RequestUser,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: CreatePurchaseOrderExpenseDto,
  ) {
    return this.financeService.createExpense(user, purchaseOrderId, dto);
  }

  @Patch('expenses/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit an expense.' })
  async updateExpense(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderExpenseDto) {
    return this.financeService.updateExpense(user, id, dto);
  }

  @Delete('expenses/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete an expense.' })
  async deleteExpense(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deleteExpense(user, id);
    return { ok: true };
  }

  // -------------------------------------------------------------------
  // CustomerOrder-Finance (2026-08-24) — the `/finance` landing page's
  // primary view. Cost = automatic rollup of linked PurchaseOrders' own
  // Finance data (unchanged routes above) + direct documents/expenses
  // recorded here.
  // -------------------------------------------------------------------

  @Get('customer-orders')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: '/finance landing page — every customer order with its rolled-up six-metric summary (purchase-order cost rollup + direct documents/expenses) and derived payment status.' })
  async listCustomerOrders(@CurrentUser() user: RequestUser, @Query() query: QueryFinanceCustomerOrdersDto) {
    return this.financeService.listCustomerOrdersWithSummary(user, query);
  }

  @Get('customer-orders/:customerOrderId/summary')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'Six-metric financial summary for one customer order, including the list of linked purchase orders each with their own summary.' })
  async getCustomerOrderSummary(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string) {
    return this.financeService.getCustomerOrderSummary(user, customerOrderId);
  }

  @Get('customer-orders/:customerOrderId/documents')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'List direct cost documents attached to this customer order (not the rolled-up purchase-order ones — see their own /finance/purchase-orders/:id/documents).' })
  async listCustomerOrderDocuments(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string) {
    return this.financeService.listCustomerOrderDocuments(user, customerOrderId);
  }

  @Post('customer-orders/:customerOrderId/documents')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Create a direct cost document (metadata only) on this customer order. Attach the actual file afterwards via the normal files API — domain FINANCE_DOCUMENT, entityType "CustomerOrderDocument", entityId = this document\'s id.' })
  async createCustomerOrderDocument(
    @CurrentUser() user: RequestUser,
    @Param('customerOrderId') customerOrderId: string,
    @Body() dto: CreateCustomerOrderDocumentDto,
  ) {
    return this.financeService.createCustomerOrderDocument(user, customerOrderId, dto);
  }

  @Get('customer-order-documents/:id')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'One customer-order document with its counterparty, payments, and derived payment status.' })
  async getCustomerOrderDocument(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.financeService.getCustomerOrderDocument(user, id);
  }

  @Patch('customer-order-documents/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit a customer-order document\'s metadata. The amount cannot be cleared once payments have been recorded against it.' })
  async updateCustomerOrderDocument(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateCustomerOrderDocumentDto) {
    return this.financeService.updateCustomerOrderDocument(user, id, dto);
  }

  @Delete('customer-order-documents/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete a customer-order document — its payments cascade with it.' })
  async deleteCustomerOrderDocument(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deleteCustomerOrderDocument(user, id);
    return { ok: true };
  }

  @Post('customer-order-documents/:id/payments')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Record a payment against a customer-order document. Rejected if the document has no amount, or if the payment (same currency as the document) would exceed its remaining balance.' })
  async addCustomerOrderPayment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CreatePurchaseOrderPaymentDto) {
    return this.financeService.addCustomerOrderPayment(user, id, dto);
  }

  @Patch('customer-order-payments/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit a customer-order payment. Same remaining-balance rule as recording one, excluding the payment being edited from its own "already paid" sum.' })
  async updateCustomerOrderPayment(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderPaymentDto) {
    return this.financeService.updateCustomerOrderPayment(user, id, dto);
  }

  @Delete('customer-order-payments/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete a customer-order payment.' })
  async deleteCustomerOrderPayment(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deleteCustomerOrderPayment(user, id);
    return { ok: true };
  }

  @Get('customer-orders/:customerOrderId/expenses')
  @RequirePermissions('finance:read')
  @ApiOperation({ summary: 'List direct additional-cost expenses on this customer order (not tied to any specific purchase order).' })
  async listCustomerOrderExpenses(@CurrentUser() user: RequestUser, @Param('customerOrderId') customerOrderId: string) {
    return this.financeService.listCustomerOrderExpenses(user, customerOrderId);
  }

  @Post('customer-orders/:customerOrderId/expenses')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Record a direct additional-cost expense on this customer order, optionally linked to its confirming document.' })
  async createCustomerOrderExpense(
    @CurrentUser() user: RequestUser,
    @Param('customerOrderId') customerOrderId: string,
    @Body() dto: CreateCustomerOrderExpenseDto,
  ) {
    return this.financeService.createCustomerOrderExpense(user, customerOrderId, dto);
  }

  @Patch('customer-order-expenses/:id')
  @RequirePermissions('finance:manage')
  @ApiOperation({ summary: 'Edit a customer-order expense.' })
  async updateCustomerOrderExpense(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateCustomerOrderExpenseDto) {
    return this.financeService.updateCustomerOrderExpense(user, id, dto);
  }

  @Delete('customer-order-expenses/:id')
  @RequirePermissions('finance:delete')
  @ApiOperation({ summary: 'Delete a customer-order expense.' })
  async deleteCustomerOrderExpense(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.financeService.deleteCustomerOrderExpense(user, id);
    return { ok: true };
  }
}
