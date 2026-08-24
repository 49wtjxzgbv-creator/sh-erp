import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
}));
jest.mock('./r2-client', () => ({
  createR2Client: () => ({ send: jest.fn() }),
  R2_BUCKET: 'test-bucket',
}));

import { FilesService } from './files.service';

describe('FilesService', () => {
  let service: FilesService;
  let prisma: any;
  let audit: any;
  let stepConversion: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        fileAsset: {
          create: jest.fn().mockResolvedValue({ id: 'f1', storageKey: 'tenants/c1/product_photo/product/p1/x.jpg' }),
          findUnique: jest.fn(),
          update: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };
    audit = { record: jest.fn() };
    stepConversion = { isStepFile: jest.fn().mockReturnValue(false), convert: jest.fn() };
    service = new FilesService(prisma, audit, stepConversion);
  });

  it('createPresignedUpload builds the tenants/{companyId}/{domain}/{entityType}/{entityId}/{filename} key layout (Phase 2 §7)', async () => {
    const res = await service.createPresignedUpload(user, {
      domain: 'PRODUCT_PHOTO',
      entityType: 'Product',
      entityId: 'p1',
      originalName: 'front view.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
    });

    const createCall = prisma.tenant.fileAsset.create.mock.calls[0][0];
    expect(createCall.data.storageKey).toMatch(/^tenants\/c1\/product_photo\/product\/p1\//);
    expect(createCall.data.storageKey).toContain('front_view.jpg'); // sanitized (space -> underscore)
    expect(createCall.data.uploadedById).toBe('u1');
    expect(res.fileAssetId).toBe('f1');
    expect(res.uploadUrl).toBe('https://r2.example.com/signed');
  });

  it('confirmUpload rejects when the object is not yet present in R2', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({
      id: 'f1',
      storageKey: 'k',
      sizeBytes: 1000,
    });
    service['r2'].send = jest.fn().mockRejectedValue(new Error('NotFound'));

    await expect(service.confirmUpload(user, 'f1')).rejects.toThrow(BadRequestException);
  });

  it('confirmUpload rejects when uploaded size does not match the declared size', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({
      id: 'f1',
      storageKey: 'k',
      sizeBytes: 1000,
    });
    service['r2'].send = jest.fn().mockResolvedValue({ ContentLength: 500 });

    await expect(service.confirmUpload(user, 'f1')).rejects.toThrow(BadRequestException);
  });

  it('confirmUpload succeeds and logs an audit event when size matches', async () => {
    const fileAsset = { id: 'f1', storageKey: 'k', sizeBytes: 1000, domain: 'PRODUCT_PHOTO', entityType: 'Product', entityId: 'p1' };
    prisma.tenant.fileAsset.findUnique.mockResolvedValue(fileAsset);
    service['r2'].send = jest.fn().mockResolvedValue({ ContentLength: 1000 });

    const result = await service.confirmUpload(user, 'f1');

    expect(result).toEqual(fileAsset);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.uploaded', entityType: 'FileAsset', entityId: 'f1' }),
    );
  });

  it('getDownloadUrl throws NotFoundException for a soft-deleted file', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', deletedAt: new Date() });
    await expect(service.getDownloadUrl(user, 'f1')).rejects.toThrow(NotFoundException);
  });

  it('delete() soft-deletes and logs an audit event', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', deletedAt: null });
    await service.delete(user, 'f1');
    expect(prisma.tenant.fileAsset.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.deleted' }));
  });

  describe('getSpreadsheetPreview', () => {
    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    async function bufferToBody(buf: Buffer) {
      return (async function* () {
        yield buf;
      })();
    }

    it('parses rows from a real .xlsx buffer', async () => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Sheet1');
      sheet.addRow(['Name', 'Amount']);
      sheet.addRow(['Acme', 100]);
      const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

      prisma.tenant.fileAsset.findUnique.mockResolvedValue({
        id: 'f1', deletedAt: null, sizeBytes: buf.byteLength, mimeType: XLSX_MIME, storageKey: 'tenants/c1/x.xlsx',
      });
      service['r2'].send = jest.fn().mockResolvedValue({ Body: await bufferToBody(buf) });

      const result = await service.getSpreadsheetPreview(user, 'f1');
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].name).toBe('Sheet1');
      expect(result.sheets[0].rows[0]).toEqual(['Name', 'Amount']);
      expect(result.sheets[0].rows[1]).toEqual(['Acme', 100]);
      expect(result.truncatedSheets).toBe(false);
    });

    it('rejects a non-.xlsx mimeType without ever touching R2', async () => {
      prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', deletedAt: null, sizeBytes: 10, mimeType: 'application/pdf' });
      const send = jest.fn();
      service['r2'].send = send;

      await expect(service.getSpreadsheetPreview(user, 'f1')).rejects.toThrow(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    it('rejects a file over the preview size cap without ever touching R2', async () => {
      prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', deletedAt: null, sizeBytes: 20 * 1024 * 1024, mimeType: XLSX_MIME });
      const send = jest.fn();
      service['r2'].send = send;

      await expect(service.getSpreadsheetPreview(user, 'f1')).rejects.toThrow(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    it('rejects bytes that are not actually a readable workbook', async () => {
      prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', deletedAt: null, sizeBytes: 10, mimeType: XLSX_MIME, storageKey: 'k' });
      service['r2'].send = jest.fn().mockResolvedValue({ Body: await bufferToBody(Buffer.from('not a workbook')) });

      await expect(service.getSpreadsheetPreview(user, 'f1')).rejects.toThrow(BadRequestException);
    });
  });
});
