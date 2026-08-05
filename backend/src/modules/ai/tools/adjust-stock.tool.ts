import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockService } from '../../inventory/stock.service';
import { AiTool, AiToolContext } from './ai-tool.interface';

/**
 * Ported from AI_TOOLS_.adjustProductStock / confirmAiAction's
 * `adjustProductStock` branch — the one critical (mutating) AI tool.
 * `critical = true` means `AiToolsRegistry.executeTool` never calls this
 * from the model-driven tool loop; it always short-circuits to
 * `needs_confirmation` first (see `ai-tool.interface.ts`). This `execute()`
 * body is the REAL mutation, only ever invoked from
 * `AiActionsService.confirmAction`, after the user has explicitly clicked
 * confirm on the pending action the UI showed them.
 *
 * Takes an absolute target quantity (`newQty`, matching the legacy tool's
 * contract) and translates it into the atomic `qtyDelta` the v2 stock
 * ledger (`StockService.applyMovement`, Module 4) actually requires —
 * consistent with every other write path in the system, never a direct
 * `Product.qty` write.
 */
@Injectable()
export class AdjustProductStockTool implements AiTool {
  readonly key = 'adjustProductStock';
  readonly description = 'КРИТИЧНА ДІЯ: змінює фактичний залишок товару на складі вручну. Вимагає підтвердження користувача перед виконанням — НЕ виконується одразу.';
  readonly parameters = {
    type: 'object',
    properties: {
      article: { type: 'string' },
      newQty: { type: 'number' },
      reason: { type: 'string', description: 'Причина коригування' },
    },
    required: ['article', 'newQty', 'reason'],
  };

  readonly critical = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  describe(args: Record<string, any>): string {
    return `Змінити залишок товару "${args.article}" на ${args.newQty} (причина: ${args.reason})`;
  }

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    const product = await this.prisma.tenant.product.findFirst({
      where: { article: { equals: String(args.article), mode: 'insensitive' }, deletedAt: null },
    });
    if (!product) {
      throw new BadRequestException(`Товар з артикулом "${args.article}" не знайдено.`);
    }

    const newQty = Number(args.newQty);
    if (!Number.isFinite(newQty)) {
      throw new BadRequestException('newQty must be a finite number.');
    }

    const delta = newQty - Number(product.qty);
    if (delta === 0) {
      return { movement: null, message: 'Залишок вже дорівнює запитаному значенню — рух не створено.' };
    }

    const movement = await this.stockService.applyMovement(context.user, {
      productId: product.id,
      warehouseId: null, // matches the legacy tool's contract: it adjusts the product-level total, not one specific warehouse's allocation
      type: 'ADJUST',
      qtyDelta: delta,
      comment: `AI-асистент: ${args.reason || ''}`,
    });

    return { movement, message: `Залишок товару "${product.article}" змінено на ${newQty}.` };
  }
}
