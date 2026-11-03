import type { TrainingCourse } from '@/components/domain/training/training-types';

/**
 * "зроби навчання по порталу постачальника... має бути збережена логіка
 * спочатку заявка потім замовлення склад і тд" (2026-11-03) — reuses the
 * main app's own training engine (`TrainingProvider`/`TrainingOverlay`,
 * components/domain/training/) rather than forking a parallel one: both
 * are already generic over a `courses` prop, and a supplier is never on
 * both `(app)` and `/supplier-portal/*` in the same tab, so sharing the
 * same `sh-erp-training-progress` localStorage key is safe (course ids
 * below are prefixed `supplier-` precisely so they can never collide with
 * the main app's own course ids there). NOT reused: `TrainingWelcomeBanner`
 * (staff-only copy/wording) and `training-sandbox.ts` (practice-step
 * cleanup — nothing here creates real data a supplier could leave behind,
 * every step below is `mode: 'demo'`).
 *
 * Step ORDER deliberately follows the real business sequence, not the
 * sidebar's own visual order (Дашборд/План виробництва/Каталог/Склад/
 * Розкрій/Замовлення/Заявки) — a заявка (price request) always precedes a
 * замовлення (order), which is what actually puts something on Склад.
 * The sidebar's own item order is left untouched; only this course's step
 * order encodes the taught sequence (`data-tour` lookup doesn't care about
 * DOM/array position, so this doesn't require reordering NAV_ITEMS).
 */
export const SUPPLIER_TRAINING_COURSES: TrainingCourse[] = [
  {
    id: 'supplier-full-cycle',
    title: 'Портал постачальника',
    description: 'Короткий огляд — від заявки на ціну до звіту про готовність.',
    steps: [
      {
        id: 'supplier-dashboard',
        title: 'Дашборд',
        what: 'Це ваша головна сторінка — тут одразу видно активні замовлення, заявки, що чекають на ціну, і найближчі поставки.',
        why: 'Щоб не заходити в кожен розділ окремо, аби зрозуміти, чи є щось термінове.',
        route: '/supplier-portal',
        targetSelector: 'supplier-nav-dashboard',
        mode: 'demo',
      },
      {
        id: 'supplier-requests',
        title: '1. Заявки на прорахунок',
        what: 'Коли нам потрібна ціна на нову позицію, яку ми ще не замовляли, ми надсилаємо сюди заявку. Ви відкриваєте її і вказуєте свою ціну за одиницю.',
        why: 'Це завжди перший крок — без вашої ціни позиція не може стати замовленням.',
        route: '/supplier-portal/requests',
        targetSelector: 'supplier-nav-requests',
        mode: 'demo',
      },
      {
        id: 'supplier-orders',
        title: '2. Замовлення на закупівлю',
        what: 'Коли ціна погоджена, заявка перетворюється на реальне замовлення — воно з\'являється тут. Тут ви підтверджуєте кількість, ціну й терміни поставки, а якщо терміни розбиті на кілька дат — підтверджуєте або пропонуєте інший графік.',
        why: 'Це вже конкретне зобов\'язання з датами й кількостями, а не просто запит ціни.',
        route: '/supplier-portal/orders',
        targetSelector: 'supplier-nav-orders',
        mode: 'demo',
      },
      {
        id: 'supplier-stock',
        title: '3. Склад',
        what: 'Тут ви самі вказуєте, скільки деталей із відкритих замовлень уже виготовлено, але ще не відправлено нам — просто число, яке висить на балансі у вас на складі.',
        why: 'Щоб ми бачили реальний прогрес, не чекаючи фактичної відправки.',
        route: '/supplier-portal/stock',
        targetSelector: 'supplier-nav-stock',
        mode: 'demo',
      },
      {
        id: 'supplier-deliveries',
        title: 'План виробництва',
        what: 'Зведений графік усіх поставок по всіх ваших відкритих замовленнях одразу, відсортований за терміновістю — протерміновано, цього тижня, далі.',
        why: 'Щоб запускати у виробництво частинами, згідно з реальними датами, а не робити все замовлення одразу в останній момент.',
        route: '/supplier-portal/deliveries',
        targetSelector: 'supplier-nav-deliveries',
        mode: 'demo',
      },
      {
        id: 'supplier-catalog',
        title: 'Каталог',
        what: 'Усі товари, які ми колись замовляли у вас або запитували ціну — накопичується автоматично. Тут можна вказати свою ціну продажу заздалегідь, ще до нового замовлення.',
        why: 'Щоб наступного разу заявка/замовлення вже бачили вашу ціну.',
        route: '/supplier-portal/catalog',
        targetSelector: 'supplier-nav-catalog',
        mode: 'demo',
      },
      {
        id: 'supplier-cutting',
        title: 'Розкрій',
        what: 'Можете самі розрахувати розкрій деталей на власному листі чи штанзі — вкажіть розміри матеріалу, оберіть позиції з каталогу або замовлень, і система покаже схему розкрою та видасть DXF для верстата.',
        why: 'Щоб спланувати, скільки матеріалу реально піде на замовлення, до того як почати різати.',
        route: '/supplier-portal/cutting',
        targetSelector: 'supplier-nav-cutting',
        mode: 'demo',
      },
    ],
  },
];
