import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SupplierPortalUploadDto } from './supplier-portal-upload.dto';

/**
 * Security-audit fix (2026-11-02): this is an external, less-trusted
 * upload path (a supplier account, not staff), so mimeType is a closed
 * allowlist rather than the staff DTO's free-text field — pins that the
 * decorator actually rejects an out-of-allowlist type.
 */
describe('SupplierPortalUploadDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(SupplierPortalUploadDto, plain);
    return validate(instance as object);
  }

  it('accepts an invoice PDF', async () => {
    const errors = await errorsFor({ originalName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 1024 });
    expect(errors).toHaveLength(0);
  });

  it('accepts an xlsx', async () => {
    const errors = await errorsFor({
      originalName: 'invoice.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a type outside the invoice allowlist', async () => {
    const errors = await errorsFor({ originalName: 'model.glb', mimeType: 'model/gltf-binary', sizeBytes: 1024 });
    expect(errors.some((e) => e.property === 'mimeType')).toBe(true);
  });

  it('rejects a dangerous inline type even though sanitizeMimeType would also catch it downstream', async () => {
    const errors = await errorsFor({ originalName: 'invoice.html', mimeType: 'text/html', sizeBytes: 1024 });
    expect(errors.some((e) => e.property === 'mimeType')).toBe(true);
  });

  it('rejects a file over the 100MB cap', async () => {
    const errors = await errorsFor({ originalName: 'invoice.pdf', mimeType: 'application/pdf', sizeBytes: 101 * 1024 * 1024 });
    expect(errors.some((e) => e.property === 'sizeBytes')).toBe(true);
  });
});
