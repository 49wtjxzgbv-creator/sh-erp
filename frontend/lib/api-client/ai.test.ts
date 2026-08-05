import {
  askHelp,
  askAboutCustomerOrder,
  askFullAssistant,
  confirmAiAction,
  cancelAiAction,
  recognizeInvoice,
  getAiSettings,
  updateAiSettings,
} from './ai';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

afterEach(() => jest.resetAllMocks());

describe('askHelp', () => {
  it('posts only the question — no history, no attachments in this DTO', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ answer: 'ok' });
    await askHelp('Як створити товар?');
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/ask-help', { question: 'Як створити товар?' });
  });
});

describe('askAboutCustomerOrder', () => {
  it('posts customerOrderId and question', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ answer: 'ok' });
    await askAboutCustomerOrder('order-1', 'Коли буде готово?');
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/ask-about-customer-order', {
      customerOrderId: 'order-1',
      question: 'Коли буде готово?',
    });
  });
});

describe('askFullAssistant', () => {
  it('forwards the full DTO shape including optional historyJson/file fields verbatim', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ answer: 'ok', history: '[]' });
    const dto = { question: 'q', historyJson: '[]', fileBase64: 'abc', fileMimeType: 'image/png' };
    await askFullAssistant(dto);
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/ask-full-assistant', dto);
  });

  it('can be called with only the required question field', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ answer: 'ok', history: '[]' });
    await askFullAssistant({ question: 'q' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/ask-full-assistant', { question: 'q' });
  });
});

describe('confirmAiAction / cancelAiAction', () => {
  it('confirmAiAction posts pendingActionId to confirm-action', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ message: 'done' });
    await confirmAiAction('pending-1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/confirm-action', { pendingActionId: 'pending-1' });
  });

  it('cancelAiAction posts pendingActionId to cancel-action — a distinct endpoint, never a DELETE', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'pending-1', status: 'CANCELLED' });
    await cancelAiAction('pending-1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/cancel-action', { pendingActionId: 'pending-1' });
    expect(mockedApiClient.delete).not.toHaveBeenCalled();
  });
});

describe('recognizeInvoice', () => {
  it('posts base64Image and mimeType, not a multipart upload', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue([]);
    await recognizeInvoice('base64data', 'image/jpeg');
    expect(mockedApiClient.post).toHaveBeenCalledWith('ai/recognize-invoice', {
      base64Image: 'base64data',
      mimeType: 'image/jpeg',
    });
  });
});

describe('getAiSettings / updateAiSettings', () => {
  it('getAiSettings is a plain GET', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ companyId: 'c1', hasCustomApiKey: false, monthlyUsageQuota: null });
    await getAiSettings();
    expect(mockedApiClient.get).toHaveBeenCalledWith('ai/settings');
  });

  it('updateAiSettings is a PUT (matches the backend controller using @Put, not @Patch)', async () => {
    (mockedApiClient.put as jest.Mock).mockResolvedValue({ companyId: 'c1', hasCustomApiKey: true, monthlyUsageQuota: 1000 });
    await updateAiSettings({ apiKey: 'new-key', monthlyUsageQuota: 1000 });
    expect(mockedApiClient.put).toHaveBeenCalledWith('ai/settings', { apiKey: 'new-key', monthlyUsageQuota: 1000 });
  });
});
