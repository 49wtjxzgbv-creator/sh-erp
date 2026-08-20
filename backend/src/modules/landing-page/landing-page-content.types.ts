/**
 * Shape of `LandingPageVersion.content` (schema.prisma) — the entire public
 * homepage's editable content, one Json blob covering all 4 app locales at
 * once. Shared between the public read side (landing-page-public.service.ts)
 * and the Super-Admin write side (../super-admin/landing-page-admin.service.ts)
 * — deliberately one file, not duplicated, so the two never drift.
 *
 * Every icon field is a key into ICON_REGISTRY below, never free-text
 * SVG/HTML — this content renders to every anonymous visitor, so accepting
 * arbitrary markup here would be a stored-XSS surface.
 */

export interface LocalizedText {
  uk: string;
  en: string;
  pl: string;
  de: string;
}

export interface LandingPageContent {
  hero: {
    eyebrow: LocalizedText;
    headline: LocalizedText;
    subheadline: LocalizedText;
    primaryCta: { label: LocalizedText; href: string };
    secondaryCta: { label: LocalizedText; href: string };
    microcopy: LocalizedText;
    heroImageId: string | null;
  };
  modules: {
    heading: LocalizedText;
    subheading: LocalizedText;
    items: Array<{
      id: string;
      icon: string;
      title: LocalizedText;
      description: LocalizedText;
      sortOrder: number;
      visible: boolean;
    }>;
  };
  showcase: {
    heading: LocalizedText;
    subheading: LocalizedText;
    steps: Array<{
      id: string;
      title: LocalizedText;
      description: LocalizedText;
      imageId: string | null;
      sortOrder: number;
    }>;
  };
  benefits: {
    heading: LocalizedText;
    subheading: LocalizedText;
    items: Array<{
      id: string;
      icon: string;
      title: LocalizedText;
      description: LocalizedText;
      sortOrder: number;
      visible: boolean;
    }>;
  };
  pricing: {
    visible: boolean;
    heading: LocalizedText;
    subheading: LocalizedText;
    highlightedPlanKey: string | null;
    // Price/limits ALWAYS come live from the real Plan table (billing module)
    // — never duplicated here, so marketing copy can never promise a price
    // or limit the real Plan rows don't back up. Matches by Plan.key.
    // `features` is a short editorial bullet list (e.g. "До 3 користувачів")
    // — human-written summary text, not machine-derived from Plan.limits'
    // raw JSON, same as the pre-editor hardcoded pricing.tsx already did.
    tierCopyOverrides: Array<{ planKey: string; description: LocalizedText; ctaLabel: LocalizedText; features: LocalizedText[] }>;
  };
  faq: {
    heading: LocalizedText;
    items: Array<{ id: string; question: LocalizedText; answer: LocalizedText; sortOrder: number; visible: boolean }>;
  };
  contact: {
    heading: LocalizedText;
    subheading: LocalizedText;
    salesEmail: string;
    responseTimeNote: LocalizedText;
    formSubmitLabel: LocalizedText;
    mailtoSubject: LocalizedText;
  };
  footer: {
    tagline: LocalizedText;
  };
  seo: {
    title: LocalizedText;
    description: LocalizedText;
    ogImageId: string | null;
  };
}

/**
 * Curated allow-list of lucide-react icon names usable in `modules[].icon`
 * and `benefits.items[].icon` — a superset of what the pre-editor hardcoded
 * landing page already used, so the Super Admin editor's icon picker never
 * has to introduce an icon the design wasn't already using somewhere.
 */
export const LANDING_ICON_REGISTRY = [
  'Factory',
  'Warehouse',
  'Truck',
  'ShoppingCart',
  'ListTree',
  'Sparkles',
  'BarChart3',
  'Users',
  'ShieldCheck',
  'Zap',
  'Building2',
  'Globe',
  'ClipboardCheck',
  'PackageCheck',
  'Boxes',
  'Handshake',
  'LineChart',
  'Layers',
] as const;

export type LandingIconName = (typeof LANDING_ICON_REGISTRY)[number];

function uk(text: string): LocalizedText {
  // en/pl/de start out as a copy of the real Ukrainian text (not machine
  // translation — nothing invented) until a Super Admin actually translates
  // each field through the editor. Matches this app's existing convention
  // for brand-new i18n surfaces (see messages/{locale}.json's own history).
  return { uk: text, en: text, pl: text, de: text };
}

/**
 * Ported verbatim from the pre-editor hardcoded components
 * (frontend/components/domain/marketing/*.tsx as of 2026-08-20), with the
 * three "Замовити демо" ("Book a demo") instances found during the audit
 * replaced — SH ERP has no demo product, so no CTA may claim one exists.
 */
export const INITIAL_LANDING_PAGE_CONTENT: LandingPageContent = {
  hero: {
    eyebrow: uk('Мультитенантна ERP нового покоління'),
    headline: uk('Виробництво, склад і продажі — в одній системі'),
    subheadline: uk(
      "SH ERP об'єднує виробництво, склад, закупівлі, продажі, BOM, HR і AI-асистента в один швидкий продукт — без хаосу з таблицями та розрізненими системами.",
    ),
    primaryCta: { label: uk('Почати безкоштовно'), href: '/register' },
    secondaryCta: { label: uk("Зв'язатися з нами"), href: '#contact' },
    microcopy: uk('Безкоштовний план Starter назавжди · Кредитна картка не потрібна'),
    heroImageId: null,
  },
  modules: {
    heading: uk('Один продукт замість десяти таблиць'),
    subheading: uk(
      'Кожен модуль SH ERP покриває реальний процес вашого бізнесу — від сировини на складі до відвантаженого замовлення клієнту.',
    ),
    items: [
    {
      id: 'production',
      icon: 'Factory',
      title: uk('Виробництво'),
      description: uk(
        'Виробничі замовлення повного циклу: резервування матеріалів, стадії виконання, серійні номери готової продукції та QC-контроль.',
      ),
      sortOrder: 0,
      visible: true,
    },
    {
      id: 'warehouse',
      icon: 'Warehouse',
      title: uk('Склад'),
      description: uk(
        'Облік залишків у реальному часі, переміщення між складами, інвентаризації з розбіжностями та повна історія рухів.',
      ),
      sortOrder: 1,
      visible: true,
    },
    {
      id: 'bom',
      icon: 'ListTree',
      title: uk('BOM'),
      description: uk(
        'Багаторівневі специфікації з версіонуванням, автоматичний розрахунок собівартості та перевірка доступності компонентів.',
      ),
      sortOrder: 2,
      visible: true,
    },
    {
      id: 'procurement',
      icon: 'Truck',
      title: uk('Закупівлі'),
      description: uk(
        'Постачальники, замовлення на закупівлю та приймання товару з автоматичним оновленням залишків складу.',
      ),
      sortOrder: 3,
      visible: true,
    },
    {
      id: 'sales',
      icon: 'ShoppingCart',
      title: uk('Продажі'),
      description: uk('Замовлення клієнтів, відвантаження та автоматичний розрахунок дефіциту з пропозиціями на закупівлю.'),
      sortOrder: 4,
      visible: true,
    },
    {
      id: 'hr',
      icon: 'Users',
      title: uk('HR та зарплата'),
      description: uk('Співробітники, відрядна оплата праці та звірка з результатами контролю якості.'),
      sortOrder: 5,
      visible: true,
    },
    {
      id: 'reports',
      icon: 'BarChart3',
      title: uk('Звіти'),
      description: uk('Рекомендації щодо поповнення запасів, оцінка вартості складу та щомісячні виробничі підсумки.'),
      sortOrder: 6,
      visible: true,
    },
    {
      id: 'ai',
      icon: 'Sparkles',
      title: uk('AI-асистент'),
      description: uk(
        'Розпізнавання рахунків постачальників, голосові команди та інтелектуальні підказки — з підтвердженням критичних дій людиною.',
      ),
      sortOrder: 7,
      visible: true,
    },
    ],
  },
  showcase: {
    heading: uk('Один наскрізний процес, від замовлення до відвантаження'),
    subheading: uk('Реальний інтерфейс SH ERP на кожному кроці — не макет, а те, що ви побачите одразу після реєстрації.'),
    // 8 fixed step ids matching the confirmed scenario — title/description
    // are honest placeholders until Phase 3 fills imageId with a real
    // screenshot; visible copy stays generic/accurate rather than
    // referencing a screenshot that doesn't exist yet.
    steps: [
      { id: 'order', title: uk('Замовлення'), description: uk('Клієнт створює замовлення — система одразу бачить, яких матеріалів бракує.'), imageId: null, sortOrder: 0 },
      { id: 'shortage-reservation', title: uk('Дефіцит і резерв'), description: uk('Наявне на складі резервується під замовлення, решта — позначається до закупівлі.'), imageId: null, sortOrder: 1 },
      { id: 'procurement', title: uk('Закупівля'), description: uk('Заявка постачальнику формується прямо з розрахунку дефіциту.'), imageId: null, sortOrder: 2 },
      { id: 'supplier-portal', title: uk('Портал постачальника'), description: uk('Постачальник підтверджує заявку у власному, окремому порталі.'), imageId: null, sortOrder: 3 },
      { id: 'receiving', title: uk('Прихід'), description: uk('Матеріал приходить на склад і одразу відображається в залишках.'), imageId: null, sortOrder: 4 },
      { id: 'auto-reservation', title: uk('Резерв'), description: uk('Отримана кількість автоматично прив’язується до замовлення, яке чекало на неї.'), imageId: null, sortOrder: 5 },
      { id: 'production', title: uk('Виробництво'), description: uk('Матеріали передаються у виробництво: етапи, серійні номери, контроль якості.'), imageId: null, sortOrder: 6 },
      { id: 'shipment', title: uk('Відвантаження'), description: uk('Готова продукція відвантажується клієнту — замовлення завершено.'), imageId: null, sortOrder: 7 },
    ],
  },
  benefits: {
    heading: uk('Побудовано для компаній, які виросли з таблиць'),
    subheading: uk(
      "SH ERP замінює розрізнені Excel-файли та застарілі системи одним продуктом, який росте разом із вашим бізнесом — від першого замовлення до сотень співробітників.",
    ),
    items: [
      {
        id: 'security',
        icon: 'ShieldCheck',
        title: uk('Безпека на рівні бази даних'),
        description: uk(
          'Ізоляція даних кожної компанії забезпечується не лише в коді, а й на рівні PostgreSQL (Row-Level Security) — подвійний захист від витоку між клієнтами.',
        ),
        sortOrder: 0,
        visible: true,
      },
      {
        id: 'scale',
        icon: 'Building2',
        title: uk('Готовність до масштабування'),
        description: uk(
          'Архітектура розрахована на тисячі компаній і мільйони записів з першого дня — не MVP, який доведеться переписувати після росту.',
        ),
        sortOrder: 1,
        visible: true,
      },
      {
        id: 'speed',
        icon: 'Zap',
        title: uk('Швидкість, а не колеса завантаження'),
        description: uk(
          'Сучасний стек (Next.js, NestJS, PostgreSQL) і наскрізна типізація API означають менше багів і миттєвий відгук інтерфейсу.',
        ),
        sortOrder: 2,
        visible: true,
      },
      {
        id: 'roles-i18n',
        icon: 'Globe',
        title: uk('Гнучкі ролі та мультимовність'),
        description: uk(
          'Повністю кастомізовані ролі та права доступу для кожної компанії, інтерфейс українською, англійською, польською та німецькою.',
        ),
        sortOrder: 3,
        visible: true,
      },
    ],
  },
  pricing: {
    visible: true,
    heading: uk('Прозорі тарифи, без прихованих умов'),
    subheading: uk('Почніть безкоштовно на плані Starter і переходьте на вищий тариф лише тоді, коли бізнес дійсно виросте.'),
    highlightedPlanKey: 'growth',
    tierCopyOverrides: [
      {
        planKey: 'starter',
        description: uk('Щоб спробувати SH ERP у справі — без ризику й без картки.'),
        ctaLabel: uk('Почати безкоштовно'),
        features: [uk('До 3 користувачів'), uk('До 500 товарів'), uk('Усі основні модулі'), uk('Email-підтримка')],
      },
      {
        planKey: 'growth',
        description: uk('Для компаній, що активно ростуть і масштабують виробництво.'),
        ctaLabel: uk('Почати безкоштовно'),
        features: [
          uk('До 15 користувачів'),
          uk('До 5 000 товарів'),
          uk('AI-асистент та розпізнавання рахунків'),
          uk('Пріоритетна підтримка'),
        ],
      },
      {
        planKey: 'enterprise',
        description: uk('Необмежене масштабування та виділена підтримка для великого бізнесу.'),
        ctaLabel: uk("Зв'язатися з нами"),
        features: [
          uk('Необмежена кількість користувачів'),
          uk('Необмежена кількість товарів'),
          uk('Виділений менеджер підтримки'),
          uk('Індивідуальні SLA'),
        ],
      },
    ],
  },
  faq: {
    heading: uk('Часті запитання'),
    items: [
      {
        id: 'migration',
        question: uk('Чи можу я перенести дані з Excel або іншої системи?'),
        answer: uk(
          'Так. Ми маємо окремий інструментарій міграції даних (імпорт товарів, залишків, специфікацій тощо) та готові допомогти з перенесенням існуючих даних без втрат.',
        ),
        sortOrder: 0,
        visible: true,
      },
      {
        id: 'security',
        question: uk('Наскільки безпечні дані моєї компанії?'),
        answer: uk(
          'Дані кожної компанії ізольовані подвійним рівнем захисту: на рівні застосунку та на рівні самої бази даних (PostgreSQL Row-Level Security). Жодна компанія не може отримати доступ до даних іншої.',
        ),
        sortOrder: 1,
        visible: true,
      },
      {
        id: 'change-plan',
        question: uk('Чи можна змінити план пізніше?'),
        answer: uk('Так, ви можете підвищити або понизити тариф у будь-який момент із розділу «Тарифи» у вашому кабінеті — без втрати даних.'),
        sortOrder: 2,
        visible: true,
      },
      {
        id: 'mobile',
        question: uk('Чи є мобільний доступ?'),
        answer: uk(
          'Інтерфейс повністю адаптивний і працює в браузері на телефоні чи планшеті вже сьогодні; нативні мобільні застосунки — у наших найближчих планах.',
        ),
        sortOrder: 3,
        visible: true,
      },
      {
        id: 'ai',
        question: uk('Що входить у AI-асистента?'),
        answer: uk(
          'Розпізнавання рахунків постачальників, відповіді на запитання щодо замовлень та голосовий режим — усі критичні дії (наприклад, коригування залишків) завжди вимагають вашого підтвердження.',
        ),
        sortOrder: 4,
        visible: true,
      },
      {
        id: 'credit-card',
        question: uk('Чи потрібна кредитна картка для реєстрації?'),
        answer: uk('Ні. План Starter безкоштовний назавжди й не вимагає жодних платіжних даних для початку роботи.'),
        sortOrder: 5,
        visible: true,
      },
    ],
  },
  contact: {
    heading: uk('Готові спробувати SH ERP?'),
    subheading: uk("Залиште контакти — ми зв'яжемось і покажемо, як SH ERP закриє саме ваші процеси."),
    salesEmail: 'hello@sh-erp.com',
    responseTimeNote: uk('Відповідаємо протягом одного робочого дня'),
    formSubmitLabel: uk('Надіслати повідомлення'),
    mailtoSubject: uk('Запит через сайт SH ERP'),
  },
  footer: {
    tagline: uk('Мультитенантна ERP-система для виробництва, складу та продажів. Продукт компанії Shyring.'),
  },
  seo: {
    title: uk('SH ERP — виробничий та складський облік для реального бізнесу'),
    description: uk(
      "SH ERP об'єднує виробництво, склад, закупівлі, продажі, BOM, HR і AI-асистента в один продукт. Безкоштовний план Starter назавжди.",
    ),
    ogImageId: null,
  },
};
