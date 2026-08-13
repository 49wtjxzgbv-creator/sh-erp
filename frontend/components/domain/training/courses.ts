import type { TrainingCourse, TrainingStep } from './training-types';

/**
 * All 16 courses' content, built directly from the real-workflow audit
 * (not invented) — every `route` and `targetSelector` corresponds to a real
 * page/button that exists today (selectors are added as plain `data-tour`
 * attributes on those real elements, see the pages listed per course).
 *
 * Two deliberate, disclosed departures from the "ideal" 21-step workflow
 * the feature was requested against, because the real system doesn't work
 * that way:
 *  - There is no separate "Клієнт" entity — `CustomerOrder.clientName` is
 *    a free-text field. Course 05 teaches that field, not a customer page.
 *  - `FinishedGood` rows are created automatically the instant a batch is
 *    started (`POST production-orders/:id/start`), BEFORE any stage work —
 *    not after "виготовлення" as the original step order assumed. Course
 *    09/14 teach the real order.
 */

const catalog: TrainingStep[] = [
  {
    id: 'catalog-open-new',
    title: 'Створення товару',
    what: 'Товар — будь-яка позиція каталогу: готовий виріб, матеріал або комплектуюча. У SH ERP це одна й та сама сутність — призначення визначається тим, де ви її використовуєте (у BOM як матеріал чи в замовленні як виріб).',
    why: 'Каталог — основа для BOM, складу, закупівель і замовлень.',
    route: '/catalog',
    targetSelector: 'catalog-new-button',
    mode: 'demo',
  },
  {
    id: 'catalog-form-fields',
    title: 'Артикул і назва',
    what: 'Артикул і назва — обов’язкові поля. Решта (одиниця виміру, категорія, ціни, вага) — опційні і заповнюються за потреби.',
    why: 'Артикул — унікальний ідентифікатор товару в усій системі: за ним товар знаходять у BOM, закупівлях, залишках.',
    route: '/catalog/new',
    targetSelector: 'catalog-form-article',
    mode: 'demo',
  },
  {
    id: 'catalog-practice-create',
    title: 'Створіть тестовий товар',
    what: 'Спробуйте самі: заповніть назву і артикул та збережіть.',
    why: 'Найкращий спосіб зрозуміти форму — заповнити її реальними даними.',
    route: '/catalog/new',
    targetSelector: 'catalog-form-save',
    mode: 'practice',
    instruction: 'Введіть назву «[Навчання] Тестовий товар», будь-який артикул (напр. TRAIN-001), оберіть одиницю виміру і натисніть «Зберегти».',
    checkpoint: { type: 'route', route: '/catalog/' },
    sandboxEntity: 'product',
  },
];

const bom: TrainingStep[] = [
  {
    id: 'bom-open-new',
    title: 'Специфікація (BOM) — це і є «виріб»',
    what: 'Те, що клієнт реально замовляє у SH ERP, — це специфікація (Assembly), а не товар з каталогу. Специфікація має власний склад (BOM) — з яких товарів/матеріалів чи інших специфікацій вона збирається.',
    why: 'Без BOM неможливо ані порахувати собівартість, ані перевірити наявність матеріалів, ані передати виріб у виробництво.',
    route: '/bom',
    targetSelector: 'bom-new-button',
    mode: 'demo',
  },
  {
    id: 'bom-components-tab',
    title: 'Додавання матеріалів у BOM',
    what: 'На вкладці «Специфікація» (Components) додаються рядки: товар або вкладена специфікація + кількість на одиницю виробу.',
    why: 'Це те, з чого система порахує собівартість і перевірить, чи вистачає матеріалів на складі.',
    route: '/bom',
    mode: 'demo',
  },
  {
    id: 'bom-availability-tab',
    title: 'Перевірка наявності та собівартості',
    what: 'Вкладка «Собівартість» рахує ціну виробу з BOM-рядків; вкладка «Наявність» перевіряє, чи вистачить матеріалів на складі для заданої кількості — і звідти ж можна одразу виготовити партію напряму з BOM (окремо від виробничих замовлень).',
    why: 'Дозволяє побачити реальну вартість і ризики нестачі матеріалів ще до передачі у виробництво.',
    route: '/bom',
    mode: 'demo',
  },
];

const warehouse: TrainingStep[] = [
  {
    id: 'inventory-levels',
    title: 'Залишки на складі',
    what: 'Таблиця «Залишки» показує реальну кількість кожного товару на кожному складі — можна редагувати кількість прямо в таблиці.',
    why: 'Це те, що бачить виробництво і продажі, коли перевіряють, чи вистачає матеріалу.',
    route: '/inventory',
    targetSelector: 'inventory-levels-table',
    mode: 'demo',
  },
  {
    id: 'inventory-record-movement',
    title: 'Рух товару',
    what: 'Кнопка «Рух товару» відкриває форму запису надходження, списання, коригування або браку — кожен рух фіксується в історії з датою і автором.',
    why: 'Кожна зміна кількості на складі має бути простежуваною — це і є облік.',
    route: '/inventory',
    targetSelector: 'inventory-record-movement-button',
    mode: 'demo',
  },
];

const orderClient: TrainingStep[] = [
  {
    id: 'client-is-a-field',
    title: 'Клієнт замовлення',
    what: 'У SH ERP немає окремої картки «Клієнт» — ім’я клієнта вписується прямо в поле форми замовлення.',
    why: 'Важливо знати це одразу: не шукайте розділ «Клієнти» в меню — його немає, і це не помилка.',
    route: '/sales/new',
    targetSelector: 'sales-form-client-name',
    mode: 'demo',
  },
];

const salesOrder: TrainingStep[] = [
  {
    id: 'sales-open-new',
    title: 'Створення замовлення',
    what: 'Замовлення клієнта — шапка (клієнт, дедлайн, пріоритет, планові дати) + рядки, кожен рядок — конкретна специфікація (виріб) і кількість.',
    why: 'Замовлення — точка входу всього виробничого циклу: від нього тягнеться виробництво, закупівлі, відвантаження.',
    route: '/sales',
    targetSelector: 'sales-new-button',
    mode: 'demo',
  },
  {
    id: 'sales-planned-dates',
    title: 'Планові дати',
    what: 'Планові дати (початок, завершення, відвантаження, доставка) вводяться прямо тут, у формі замовлення чи його рядка — окремого екрана «планування» немає.',
    why: 'Ці дати — те, що потім показує План-графік як плановий шар (на відміну від фактичного прогресу).',
    route: '/sales/new',
    targetSelector: 'sales-form-planned-dates',
    mode: 'demo',
  },
  {
    id: 'sales-practice-create',
    title: 'Створіть тестове замовлення',
    what: 'Спробуйте самі: впишіть клієнта, додайте один рядок з будь-якою специфікацією і збережіть.',
    why: 'Реальне замовлення — найкращий спосіб побачити, як шапка і рядки пов’язані.',
    route: '/sales/new',
    targetSelector: 'sales-form-save',
    mode: 'practice',
    instruction: 'Введіть клієнта «[Навчання] Тестовий клієнт», додайте один рядок (оберіть будь-яку специфікацію і кількість) і натисніть «Створити».',
    checkpoint: { type: 'route', route: '/sales/' },
    sandboxEntity: 'customerOrder',
  },
];

const giveToProduction: TrainingStep[] = [
  {
    id: 'give-to-production-button',
    title: 'Передача у виробництво',
    what: 'На картці замовлення кожен рядок має кнопку «Дати у виробництво» — вона створює виробничу партію на задану кількість (можна передавати частинами). Є й кнопка «Дати все у виробництво» для всього замовлення одразу.',
    why: 'Це межа між «продажами» і «виробництвом» — саме тут з’являється перша виробнича партія.',
    route: '/sales',
    mode: 'demo',
  },
];

const production: TrainingStep[] = [
  {
    id: 'production-order-created',
    title: 'Виробнича партія',
    what: 'Виробнича партія (Production Order) — те, що щойно створила кнопка «Дати у виробництво» (або створюється напряму на сторінці «Нове виробництво» для внутрішніх потреб, без прив’язки до замовлення).',
    why: 'Партія — одиниця, яку далі проводять через етапи виробництва.',
    route: '/production',
    targetSelector: 'production-new-button',
    mode: 'demo',
  },
  {
    id: 'production-start',
    title: 'Початок виробництва',
    what: 'Кнопка «Почати виробництво» перевіряє, чи вистачає матеріалів, фіксує собівартість і одразу створює всі одиниці готової продукції (Finished Good) зі статусом «На складі» — ще до того, як пройде хоч один етап.',
    why: 'Важливо розуміти цей порядок: готова продукція існує в системі одразу після старту, а не після завершення всіх етапів — етапи лише відстежують реальний прогрес виготовлення.',
    route: '/production',
    mode: 'demo',
  },
];

const stages: TrainingStep[] = [
  {
    id: 'stages-catalogue',
    title: 'Каталог етапів виробництва',
    what: 'Етапи (наприклад: Заготівля, Обробка, Зварювання, Контроль) налаштовуються один раз на всю компанію на сторінці «Етапи» — можна додавати, переставляти порядок і видаляти.',
    why: 'Це той самий список етапів, який потім бачить кожна виробнича партія і План-графік.',
    route: '/production/stages',
    targetSelector: 'production-stages-list',
    mode: 'demo',
  },
  {
    id: 'stages-advance',
    title: 'Просування партії етапами',
    what: 'На картці партії — одна кнопка «Наступний етап», яка фіксує момент переходу і рухає партію по черзі етапів; на останньому етапі партія автоматично завершується.',
    why: 'Кожен перехід записується з часовою міткою — це і є фактичний прогрес виробництва.',
    route: '/production',
    mode: 'demo',
  },
];

const planner: TrainingStep[] = [
  {
    id: 'planner-overview',
    title: 'План-графік — диспетчерський центр',
    what: 'План-графік — не календар, а виробнича дошка: рядки — реальні етапи виробництва (плюс Закупівлі та Відвантаження), картки — партії, позиціоновані й розмірені реальними датами.',
    why: 'Це головний екран, де видно все виробництво одночасно — хто де застряг, що прострочено, чого бракує.',
    route: '/planner',
    targetSelector: 'planner-board',
    mode: 'demo',
  },
  {
    id: 'planner-kpi',
    title: 'KPI та проблеми',
    what: 'Панель KPI зверху показує кількість замовлень/виробів/партій у роботі і скільки з них під ризиком. «Диспетчер проблем» перелічує кожну конкретну знахідку (нестача матеріалу, прострочена закупівля, ризик дедлайну).',
    why: 'Так ви за секунди знаходите, що саме блокує виробництво, не гортаючи кожне замовлення вручну.',
    route: '/planner',
    targetSelector: 'planner-kpi-bar',
    mode: 'demo',
  },
  {
    id: 'planner-drilldown',
    title: 'Від проблеми — до партії',
    what: 'Клік по проблемі в списку веде прямо на картку відповідного замовлення чи виробничої партії — так само працює клік по будь-якій картці на дошці.',
    why: 'Проблему недостатньо побачити — треба за один клік дійти до місця, де її можна вирішити.',
    route: '/planner',
    targetSelector: 'planner-problems-panel',
    mode: 'demo',
  },
  {
    id: 'planner-scales',
    title: 'Масштаби: День → Рік',
    what: 'Перемикачі День/Тиждень/Місяць/Квартал/Рік змінюють масштаб тієї самої дошки — це не окремі календарі, а один і той самий план, наближений чи віддалений.',
    why: 'День — для точного планування години; Рік — щоб побачити завантаження виробництва наперед.',
    route: '/planner',
    targetSelector: 'planner-scale-buttons',
    mode: 'demo',
  },
];

const procurement: TrainingStep[] = [
  {
    id: 'procurement-open-new',
    title: 'Замовлення постачальнику',
    what: 'Закупівля — постачальник (реальний з довідника або просто назва), рядки з товарами, кількістю і очікуваною ціною.',
    why: 'Це те, що закриває нестачу матеріалів, яку показав План-графік чи перевірка наявності BOM.',
    route: '/procurement',
    targetSelector: 'procurement-new-button',
    mode: 'demo',
  },
  {
    id: 'procurement-practice-create',
    title: 'Створіть тестову закупівлю',
    what: 'Спробуйте самі: оберіть постачальника (або впишіть назву), додайте один рядок і збережіть.',
    why: 'Реальна закупівля — найкоротший шлях зрозуміти, як рядки замовлення постачальнику пов’язані зі складом.',
    route: '/procurement/new',
    targetSelector: 'procurement-form-save',
    mode: 'practice',
    instruction:
      'Впишіть постачальника «[Навчання] Тестовий постачальник», додайте один рядок із будь-яким товаром і кількістю, натисніть «Створити». Зверніть увагу: закупівлі не можна видалити чи скасувати в SH ERP — ця тестова закупівля залишиться в системі (як і будь-яка реальна), «Очистити навчальні дані» її не прибере.',
    checkpoint: { type: 'route', route: '/procurement/' },
  },
];

const receiving: TrainingStep[] = [
  {
    id: 'procurement-receive',
    title: 'Отримання матеріалів',
    what: 'На картці закупівлі — поля «отримано зараз» і «фактична ціна» на кожен рядок, кнопка «Отримати доставку» проводить реальний рух складу типу «Надходження».',
    why: 'Матеріал фізично потрапляє на склад саме тут — до цього моменту закупівля лише «в дорозі».',
    route: '/procurement',
    mode: 'demo',
  },
];

const finishedGoods: TrainingStep[] = [
  {
    id: 'finished-goods-list',
    title: 'Готова продукція',
    what: 'Кожна одиниця готової продукції має власний серійний номер, статус («На складі», «Відвантажено», «Використано», «На переробку», «Брак») і історію контролю якості.',
    why: 'Нагадування: ці записи вже існують з моменту старту виробництва (курс «Виробничі партії»), незалежно від того, на якому етапі зараз партія.',
    route: '/production/finished-goods',
    targetSelector: 'finished-goods-list',
    mode: 'demo',
  },
  {
    id: 'finished-goods-qc',
    title: 'Контроль якості (QC)',
    what: 'На картці одиниці — чекліст контролю, результат «Прийнято»/«На переробку» і коментар.',
    why: 'Це офіційна фіксація того, що виріб перевірено і готовий до відвантаження.',
    route: '/production/finished-goods',
    mode: 'demo',
  },
];

const shipments: TrainingStep[] = [
  {
    id: 'shipments-open-new',
    title: 'Відвантаження',
    what: 'Нове відвантаження — перевізник, накладна, і конкретні одиниці готової продукції (лише зі статусом «На складі») зі списку.',
    why: 'Відвантаження — те, що переводить готову продукцію від «на складі» до «у клієнта».',
    route: '/sales/shipments',
    targetSelector: 'shipments-new-button',
    mode: 'demo',
  },
  {
    id: 'shipments-deliver',
    title: 'Позначити доставленим',
    what: 'На картці відвантаження — кнопка «Позначити доставленим», яка фіксує факт доставки.',
    why: 'Це фінальний статус відвантаження — після нього змінити вже не можна.',
    route: '/sales/shipments',
    mode: 'demo',
  },
];

const completion: TrainingStep[] = [
  {
    id: 'order-complete-button',
    title: 'Завершення замовлення',
    what: 'Кнопка «Завершити замовлення» на картці замовлення — повністю ручна дія: система не перевіряє автоматично, чи все відвантажено. Це свідоме рішення співробітника.',
    why: 'Важливо знати чесно: завершення замовлення і повне відвантаження — дві незалежні дії, не одна автоматична послідовність.',
    route: '/sales',
    mode: 'demo',
  },
];

function course(id: string, title: string, description: string, steps: TrainingStep[]): TrainingCourse {
  return { id, title, description, steps };
}

export const COURSES: TrainingCourse[] = [
  course('basics', '01 — Основи SH ERP', 'Огляд системи: що є в меню і як усе пов’язано.', [
    {
      id: 'basics-welcome',
      title: 'Вітаємо в SH ERP',
      what: 'SH ERP — система обліку виробництва обладнання: від товару в каталозі до відвантаження готового виробу клієнту.',
      why: 'Це навчання проведе вас через увесь реальний цикл — саме так, як він працює в системі сьогодні.',
      route: '/dashboard',
      mode: 'demo',
    },
    {
      id: 'basics-sidebar',
      title: 'Бічне меню',
      what: 'Кожен пункт меню — окремий модуль: Каталог, Склад, Специфікації (BOM), Виробництво, Закупівлі, Продажі, План-графік.',
      why: 'Наступні уроки пройдуть саме по цих модулях, у тому порядку, в якому вони реально використовуються.',
      route: '/dashboard',
      targetSelector: 'sidebar-nav',
      mode: 'demo',
    },
  ]),
  course('catalog', '02 — Товари та вироби', 'Що таке товар у каталозі і як його створити.', catalog),
  course('bom', '03 — Матеріали та BOM', 'Специфікація (BOM) — те, що реально продається і виробляється.', bom),
  course('warehouse', '04 — Склад', 'Залишки, рух товару, коригування кількості.', warehouse),
  course('client', '05 — Клієнт', 'Як у SH ERP насправді зберігається клієнт замовлення.', orderClient),
  course('sales-order', '06 — Замовлення', 'Створення замовлення клієнта і додавання виробів.', salesOrder),
  course('planning', '07 — Планування замовлення', 'Де вводяться планові дати.', [orderClient[0], salesOrder[1]]),
  course('give-to-production', '08 — Передача у виробництво', 'Як виріб із замовлення стає виробничою партією.', giveToProduction),
  course('production-orders', '09 — Виробничі партії', 'Що таке партія і що відбувається при старті виробництва.', production),
  course('stages', '10 — Етапи виробництва', 'Каталог етапів і просування партії по них.', stages),
  course('planner', '11 — План-графік', 'Диспетчерський центр: KPI, проблеми, масштаби, drill-down.', planner),
  course('procurement', '12 — Закупівлі', 'Замовлення матеріалів постачальнику.', procurement),
  course('receiving', '13 — Приймання матеріалів', 'Як закупівля перетворюється на реальний залишок на складі.', receiving),
  course('finished-goods', '14 — Готова продукція', 'Серійні одиниці, статуси, контроль якості.', finishedGoods),
  course('shipments', '15 — Відвантаження', 'Від готової продукції на складі до доставки клієнту.', shipments),
  course(
    'full-cycle',
    '16 — Повний цикл: від замовлення до клієнта',
    'Наскрізний прогін усього реального процесу в одному сценарії — демонстрація, без повторного створення тестових даних.',
    [
      ...orderClient,
      ...salesOrder.filter((s) => s.mode === 'demo'),
      ...giveToProduction,
      ...production,
      ...stages,
      ...procurement.filter((s) => s.mode === 'demo'),
      ...receiving,
      ...finishedGoods,
      ...shipments,
      ...completion,
    ],
  ),
];

export function findCourse(id: string): TrainingCourse | undefined {
  return COURSES.find((c) => c.id === id);
}
