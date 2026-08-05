import { LayoutDashboard, Package, Warehouse, ListTree, Factory, Truck, ShoppingCart } from 'lucide-react';

const NAV = [
  { icon: LayoutDashboard, label: 'Дашборд', active: true },
  { icon: Package, label: 'Каталог' },
  { icon: Warehouse, label: 'Склад' },
  { icon: ListTree, label: 'BOM' },
  { icon: Factory, label: 'Виробництво' },
  { icon: Truck, label: 'Закупівлі' },
  { icon: ShoppingCart, label: 'Продажі' },
];

const STATS = [
  { label: 'Активні замовлення', value: '128', delta: '+12%' },
  { label: 'На складі, SKU', value: '2 340', delta: '+4%' },
  { label: 'У виробництві', value: '37', delta: '+8%' },
];

const ROWS = [
  { article: 'FG-1042', name: 'Корпус вузла А12', qty: '84', status: 'В наявності' },
  { article: 'FG-1088', name: 'Плата керування B3', qty: '12', status: 'Мало' },
  { article: 'FG-1103', name: 'Кабельний джгут C7', qty: '0', status: 'Немає' },
  { article: 'FG-1120', name: 'Кронштейн D2', qty: '256', status: 'В наявності' },
];

const STATUS_STYLE: Record<string, string> = {
  'В наявності': 'bg-success/15 text-success',
  Мало: 'bg-warning/15 text-warning',
  Немає: 'bg-destructive/15 text-destructive',
};

/**
 * A hand-built illustrative mockup of the real authenticated dashboard —
 * deliberately NOT a screenshot claiming to be a live capture (this app has
 * no image-capture pipeline, and a stale screenshot rots faster than this
 * approach does). Structure mirrors the real sidebar's module list
 * (components/domain/shell/sidebar.tsx) and DataTable/Badge visual language
 * exactly, so it reads as an honest, accurate representation of the actual
 * product rather than generic stock-photo UI.
 */
export function ProductPreview() {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-primary/10">
      {/* Fake browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 rounded-md bg-background/60 px-3 py-0.5 text-[11px] text-muted-foreground">
          app.sh-erp.com/dashboard
        </span>
      </div>

      <div className="flex text-left">
        {/* Sidebar */}
        <div className="hidden w-40 shrink-0 border-r border-border bg-card/60 p-2 sm:block">
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={
                'mb-0.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ' +
                (active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')
              }
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </div>
          ))}
        </div>

        {/* Main panel */}
        <div className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-semibold">{stat.value}</span>
                  <span className="text-[11px] font-medium text-success">{stat.delta}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Артикул</th>
                  <th className="px-3 py-2 font-medium">Назва</th>
                  <th className="px-3 py-2 font-medium">К-сть</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ROWS.map((row) => (
                  <tr key={row.article}>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{row.article}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.qty}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
