import { QuotationRendererService, QuotationRenderData } from './quotation-renderer.service';

describe('QuotationRendererService', () => {
  let service: QuotationRendererService;

  const baseData = (overrides: Partial<QuotationRenderData> = {}): QuotationRenderData => ({
    number: 'КП-2026-0001',
    createdAt: new Date('2026-08-28T00:00:00Z'),
    validUntil: new Date('2026-09-28T00:00:00Z'),
    currency: 'EUR',
    customer: { name: 'Client LLC', contactPerson: 'Іван Іванов', phone: '+380501112233', email: 'ivan@client.com', address: 'Kyiv' },
    items: [
      {
        kind: 'ASSEMBLY',
        nameSnapshot: 'Cabinet X',
        descriptionSnapshot: 'Oak, 2 doors',
        quantity: 2,
        unit: 'шт',
        unitPrice: 5000,
        discountPercent: 5,
        discountAmount: 500,
        total: 9500,
        article: null,
        photoUrl: null,
      },
    ],
    subtotal: 10000,
    discountAmount: 500,
    total: 9500,
    paymentTerms: '50% передоплата',
    deliveryTerms: null,
    installationTerms: null,
    notes: null,
    companyDetailsText: null,
    accentColor: '#6423d0',
    logoUrl: null,
    visibleBlocks: {},
    ...overrides,
  });

  beforeEach(() => {
    service = new QuotationRendererService();
  });

  it('renders a well-formed HTML document containing the quotation number, customer, and totals', () => {
    const html = service.renderHtml(baseData());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('КП-2026-0001');
    expect(html).toContain('Client LLC');
    expect(html).toContain('Cabinet X');
    expect(html).toContain('9500.00 EUR');
  });

  it('never includes cost or margin figures — only client-facing pricing fields exist on the input at all', () => {
    const html = service.renderHtml(baseData());
    expect(html).not.toMatch(/\bcost\b/i); // word-boundary — CSS "margin-top" etc. legitimately contains "margin", but never "cost"
    expect(html).not.toMatch(/маржа|маржинальн/i);
    expect(html).not.toMatch(/собівартіст/i);
  });

  it('escapes HTML-significant characters in user-entered text — a customer name cannot inject markup', () => {
    const html = service.renderHtml(baseData({ customer: { name: '<script>alert(1)</script>', contactPerson: null, phone: null, email: null, address: null } }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an item name containing quotes/angle brackets', () => {
    const html = service.renderHtml(
      baseData({
        items: [
          { kind: 'CUSTOM', nameSnapshot: '"><img src=x onerror=alert(1)>', descriptionSnapshot: null, quantity: 1, unit: 'шт', unitPrice: 1, discountPercent: 0, discountAmount: 0, total: 1, article: null, photoUrl: null },
        ],
      }),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('always renders the platform logo (SH-ERP.PRO), and additionally the tenant\'s own logo only when logoUrl is provided', () => {
    const withoutTenantLogo = service.renderHtml(baseData({ logoUrl: null }));
    expect(withoutTenantLogo).toContain('data:image/png;base64,');
    const imgCount = (withoutTenantLogo.match(/<img /g) ?? []).length;
    expect(imgCount).toBe(1); // platform logo only

    const withTenantLogo = service.renderHtml(baseData({ logoUrl: 'https://files.example.com/logo.png?token="x' }));
    const imgCountWithTenant = (withTenantLogo.match(/<img /g) ?? []).length;
    expect(imgCountWithTenant).toBe(2); // platform logo + tenant logo, side by side
    expect(withTenantLogo).not.toContain('token="x"'); // the raw unescaped quote must not survive into the attribute
  });

  it('renders an item photo and article when present, and omits the photo element when absent', () => {
    const withPhoto = service.renderHtml(
      baseData({
        items: [
          { kind: 'ASSEMBLY', nameSnapshot: 'Cabinet X', descriptionSnapshot: null, quantity: 1, unit: 'шт', unitPrice: 100, discountPercent: 0, discountAmount: 0, total: 100, article: 'ASM-042', photoUrl: 'https://files.example.com/photo.jpg' },
        ],
      }),
    );
    expect(withPhoto).toContain('class="item-photo"');
    expect(withPhoto).toContain('https://files.example.com/photo.jpg');
    expect(withPhoto).toContain('ASM-042');

    const withoutPhoto = service.renderHtml(baseData()); // baseData's item has article:null, photoUrl:null
    expect(withoutPhoto).not.toContain('class="item-photo"');
  });

  it('omits a term block entirely when its text is null, and respects visibleBlocks=false even when text is present', () => {
    const withNotes = service.renderHtml(baseData({ notes: 'Термінове замовлення' }));
    expect(withNotes).toContain('Термінове замовлення');

    const hiddenNotes = service.renderHtml(baseData({ notes: 'Термінове замовлення', visibleBlocks: { notes: false } }));
    expect(hiddenNotes).not.toContain('Термінове замовлення');
  });

  it('falls back to a safe default accent color when accentColor is not a valid hex value', () => {
    const html = service.renderHtml(baseData({ accentColor: 'javascript:alert(1)' }));
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('#6423d0');
  });

  it('always ends with the sh-erp.com / by Shyryng footer, matching the rest of the app\'s printed documents', () => {
    const html = service.renderHtml(baseData());
    expect(html).toContain('sh-erp.com');
    expect(html).toContain('by Shyryng');
  });
});
