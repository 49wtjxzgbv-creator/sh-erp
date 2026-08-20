'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/domain/shell/confirm-dialog';
import { LocaleSwitcher } from '@/components/domain/super-admin/landing-editor/locale-switcher';
import { LocalizedTextField, LocalizedTextareaField } from '@/components/domain/super-admin/landing-editor/localized-field';
import { SortableList } from '@/components/domain/super-admin/landing-editor/sortable-list';
import { MediaPicker } from '@/components/domain/super-admin/landing-editor/media-picker';
import { getLandingIcon, LANDING_ICON_REGISTRY } from '@/lib/landing-page/icon-registry';
import { landingPageAdminApi } from '@/lib/super-admin/landing-page-api';
import { superAdminApi } from '@/lib/super-admin/api';
import type { Locale } from '@/lib/i18n-locales';
import type { LandingPageContent, LocalizedText } from '@/lib/landing-page/types';

const EMPTY_LOCALIZED: LocalizedText = { uk: '', en: '', pl: '', de: '' };

interface PlanRow {
  id: string;
  key: string;
  name: string;
  monthlyPriceEur: string;
  limits: Record<string, unknown>;
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function LandingPageEditorPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>('uk');
  const [content, setContent] = useState<LandingPageContent | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  useEffect(() => {
    landingPageAdminApi
      .getDraft()
      .then((row) => setContent(row.content))
      .catch((err) => setError(err instanceof Error ? err.message : 'Не вдалося завантажити чернетку'))
      .finally(() => setLoading(false));
    superAdminApi.get<PlanRow[]>('super-admin/plans').then(setPlans);
  }, []);

  async function refreshPlans() {
    setPlans(await superAdminApi.get<PlanRow[]>('super-admin/plans'));
  }

  async function handleSave() {
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      await landingPageAdminApi.saveDraft(content);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      await handleSaveSilent();
      await landingPageAdminApi.publish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося опублікувати');
    } finally {
      setPublishing(false);
      setPublishConfirmOpen(false);
    }
  }

  async function handleSaveSilent() {
    if (!content) return;
    await landingPageAdminApi.saveDraft(content);
  }

  async function handleDiscard() {
    setError(null);
    try {
      const row = await landingPageAdminApi.discardDraft();
      setContent(row.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося скасувати зміни');
    } finally {
      setDiscardConfirmOpen(false);
    }
  }

  if (loading) return <p className="text-slate-400">Завантаження…</p>;
  if (!content) return <p className="text-destructive">{error ?? 'Не вдалося завантажити чернетку.'}</p>;

  function set<K extends keyof LandingPageContent>(key: K, value: LandingPageContent[K]) {
    setContent((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Головна сторінка</h1>
          <p className="text-sm text-slate-400">Редагування контенту публічного лендингу — Draft → Preview → Publish.</p>
        </div>
        <LocaleSwitcher locale={locale} onChange={setLocale} />
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-900/95 p-3 backdrop-blur">
        <Button onClick={handleSave} loading={saving}>
          Зберегти чернетку
        </Button>
        {/*
          Deliberately a same-tab navigation (router.push), NOT window.open(url,
          '_blank') — the Super Admin session is in-memory only, by explicit
          design (session-store.ts's own header comment: "a reload logs the
          super admin out"), so a new tab/window starts with zero session and
          bounces straight to /super-admin/login. Same-tab navigation is the
          only way Preview can carry the session across.
        */}
        <Button
          variant="outline"
          onClick={async () => {
            await handleSaveSilent();
            router.push('/super-admin/landing/preview');
          }}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Перегляд
        </Button>
        <Button variant="destructive" onClick={() => setPublishConfirmOpen(true)} loading={publishing}>
          Опублікувати
        </Button>
        <Button variant="ghost" onClick={() => setDiscardConfirmOpen(true)}>
          Скасувати зміни
        </Button>
        {savedAt && <span className="text-xs text-slate-500">Збережено {savedAt.toLocaleTimeString('uk-UA')}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Link href="/super-admin/landing/versions" className="ml-auto text-xs text-slate-400 hover:text-slate-200">
          Історія публікацій
        </Link>
      </div>

      <Tabs defaultValue="hero">
        <TabsList className="flex-wrap border-slate-800">
          <TabsTrigger value="hero">Hero</TabsTrigger>
          <TabsTrigger value="modules">Модулі</TabsTrigger>
          <TabsTrigger value="showcase">Сценарій</TabsTrigger>
          <TabsTrigger value="benefits">Переваги</TabsTrigger>
          <TabsTrigger value="pricing">Тарифи</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="contact">Контакти</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="hero">
          <HeroEditor value={content.hero} locale={locale} onChange={(hero) => set('hero', hero)} />
        </TabsContent>
        <TabsContent value="modules">
          <ModulesEditor value={content.modules} locale={locale} onChange={(modules) => set('modules', modules)} />
        </TabsContent>
        <TabsContent value="showcase">
          <ShowcaseEditor value={content.showcase} locale={locale} onChange={(showcase) => set('showcase', showcase)} />
        </TabsContent>
        <TabsContent value="benefits">
          <BenefitsEditor value={content.benefits} locale={locale} onChange={(benefits) => set('benefits', benefits)} />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingEditor value={content.pricing} locale={locale} onChange={(pricing) => set('pricing', pricing)} plans={plans} onPlansChange={refreshPlans} />
        </TabsContent>
        <TabsContent value="faq">
          <FaqEditor value={content.faq} locale={locale} onChange={(faq) => set('faq', faq)} />
        </TabsContent>
        <TabsContent value="contact">
          <ContactEditor value={content.contact} locale={locale} onChange={(contact) => set('contact', contact)} />
          <FooterEditor value={content.footer} locale={locale} onChange={(footer) => set('footer', footer)} />
        </TabsContent>
        <TabsContent value="seo">
          <SeoEditor value={content.seo} locale={locale} onChange={(seo) => set('seo', seo)} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={publishConfirmOpen}
        onOpenChange={setPublishConfirmOpen}
        title="Опублікувати зміни?"
        description="Поточна опублікована версія буде архівована, а чернетка стане новою публічною версією сторінки."
        onConfirm={handlePublish}
        confirmLabel="Опублікувати"
        confirming={publishing}
      />
      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title="Скасувати незбережені зміни?"
        description="Чернетка повернеться до поточної опублікованої версії. Це не можна скасувати."
        onConfirm={handleDiscard}
        confirmLabel="Скасувати зміни"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function HeroEditor({ value, locale, onChange }: { value: LandingPageContent['hero']; locale: Locale; onChange: (v: LandingPageContent['hero']) => void }) {
  return (
    <Section title="Hero — перший екран">
      <LocalizedTextField label="Значок (eyebrow)" value={value.eyebrow} locale={locale} onChange={(eyebrow) => onChange({ ...value, eyebrow })} />
      <LocalizedTextField label="Заголовок" value={value.headline} locale={locale} onChange={(headline) => onChange({ ...value, headline })} />
      <LocalizedTextareaField label="Підзаголовок" value={value.subheadline} locale={locale} onChange={(subheadline) => onChange({ ...value, subheadline })} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-slate-800 p-3">
          <p className="text-xs font-medium text-slate-400">Основна кнопка</p>
          <LocalizedTextField label="Текст" value={value.primaryCta.label} locale={locale} onChange={(label) => onChange({ ...value, primaryCta: { ...value.primaryCta, label } })} />
          <div className="space-y-1.5">
            <Label className="text-slate-300">URL</Label>
            <Input
              value={value.primaryCta.href}
              onChange={(e) => onChange({ ...value, primaryCta: { ...value.primaryCta, href: e.target.value } })}
              className="border-slate-700 bg-slate-800 text-slate-100"
            />
          </div>
        </div>
        <div className="space-y-2 rounded-md border border-slate-800 p-3">
          <p className="text-xs font-medium text-slate-400">Другорядна кнопка</p>
          <LocalizedTextField label="Текст" value={value.secondaryCta.label} locale={locale} onChange={(label) => onChange({ ...value, secondaryCta: { ...value.secondaryCta, label } })} />
          <div className="space-y-1.5">
            <Label className="text-slate-300">URL</Label>
            <Input
              value={value.secondaryCta.href}
              onChange={(e) => onChange({ ...value, secondaryCta: { ...value.secondaryCta, href: e.target.value } })}
              className="border-slate-700 bg-slate-800 text-slate-100"
            />
          </div>
        </div>
      </div>
      <LocalizedTextField label="Дрібний текст під кнопками" value={value.microcopy} locale={locale} onChange={(microcopy) => onChange({ ...value, microcopy })} />
      <MediaPicker label="Скріншот hero" value={value.heroImageId} onChange={(heroImageId) => onChange({ ...value, heroImageId })} />
    </Section>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const Icon = getLandingIcon(value);
  return (
    <div className="space-y-1.5">
      <Label className="text-slate-300">Іконка</Label>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(LANDING_ICON_REGISTRY).map((key) => {
          const KeyIcon = getLandingIcon(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              title={key}
              className={`flex h-8 w-8 items-center justify-center rounded border ${key === value ? 'border-primary bg-primary/20 text-primary' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
            >
              <KeyIcon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">Вибрано: <Icon className="inline h-3 w-3" /> {value}</p>
    </div>
  );
}

function VisibilitySwitch({ visible, onChange }: { visible: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={visible} onCheckedChange={onChange} />
      <span className="text-xs text-slate-400">{visible ? 'Показано' : 'Приховано'}</span>
    </div>
  );
}

function ModulesEditor({ value, locale, onChange }: { value: LandingPageContent['modules']; locale: Locale; onChange: (v: LandingPageContent['modules']) => void }) {
  function updateItems(items: LandingPageContent['modules']['items']) {
    onChange({ ...value, items: items.map((it, i) => ({ ...it, sortOrder: i })) });
  }
  function addItem() {
    updateItems([
      ...value.items,
      { id: newId('module'), icon: 'Sparkles', title: EMPTY_LOCALIZED, description: EMPTY_LOCALIZED, sortOrder: value.items.length, visible: true },
    ]);
  }
  return (
    <Section title="Секція «Модулі»">
      <LocalizedTextField label="Заголовок секції" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <LocalizedTextareaField label="Підзаголовок секції" value={value.subheading} locale={locale} onChange={(subheading) => onChange({ ...value, subheading })} />
      <SortableList
        items={value.items}
        onReorder={updateItems}
        renderItem={(item) => (
          <div className="space-y-2 rounded-md border border-slate-800 p-3">
            <div className="flex items-center justify-between">
              <VisibilitySwitch visible={item.visible} onChange={(visible) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, visible } : i)))} />
              <Button variant="ghost" size="sm" onClick={() => updateItems(value.items.filter((i) => i.id !== item.id))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <IconPicker value={item.icon} onChange={(icon) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, icon } : i)))} />
            <LocalizedTextField label="Назва" value={item.title} locale={locale} onChange={(title) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, title } : i)))} />
            <LocalizedTextareaField label="Опис" value={item.description} locale={locale} onChange={(description) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, description } : i)))} />
          </div>
        )}
      />
      <Button variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-2 h-4 w-4" />
        Додати модуль
      </Button>
    </Section>
  );
}

function ShowcaseEditor({ value, locale, onChange }: { value: LandingPageContent['showcase']; locale: Locale; onChange: (v: LandingPageContent['showcase']) => void }) {
  function updateSteps(steps: LandingPageContent['showcase']['steps']) {
    onChange({ ...value, steps: steps.map((s, i) => ({ ...s, sortOrder: i })) });
  }
  return (
    <Section title="Секція «Як це працює» (8-кроковий сценарій)">
      <LocalizedTextField label="Заголовок секції" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <LocalizedTextareaField label="Підзаголовок секції" value={value.subheading} locale={locale} onChange={(subheading) => onChange({ ...value, subheading })} />
      <SortableList
        items={value.steps}
        onReorder={updateSteps}
        renderItem={(step, i) => (
          <div className="space-y-2 rounded-md border border-slate-800 p-3">
            <p className="text-xs font-medium text-slate-500">Крок {i + 1} · {step.id}</p>
            <LocalizedTextField label="Назва кроку" value={step.title} locale={locale} onChange={(title) => updateSteps(value.steps.map((s) => (s.id === step.id ? { ...s, title } : s)))} />
            <LocalizedTextareaField label="Опис" value={step.description} locale={locale} onChange={(description) => updateSteps(value.steps.map((s) => (s.id === step.id ? { ...s, description } : s)))} />
            <MediaPicker label="Скріншот" value={step.imageId} onChange={(imageId) => updateSteps(value.steps.map((s) => (s.id === step.id ? { ...s, imageId } : s)))} />
          </div>
        )}
      />
      <p className="text-xs text-slate-500">Кроки сценарію фіксовані (8 реальних етапів замовлення) — можна змінювати порядок, текст і скріншоти, але не додавати/видаляти кроки.</p>
    </Section>
  );
}

function BenefitsEditor({ value, locale, onChange }: { value: LandingPageContent['benefits']; locale: Locale; onChange: (v: LandingPageContent['benefits']) => void }) {
  function updateItems(items: LandingPageContent['benefits']['items']) {
    onChange({ ...value, items: items.map((it, i) => ({ ...it, sortOrder: i })) });
  }
  function addItem() {
    updateItems([
      ...value.items,
      { id: newId('benefit'), icon: 'Sparkles', title: EMPTY_LOCALIZED, description: EMPTY_LOCALIZED, sortOrder: value.items.length, visible: true },
    ]);
  }
  return (
    <Section title="Секція «Переваги»">
      <LocalizedTextField label="Заголовок секції" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <LocalizedTextareaField label="Підзаголовок секції" value={value.subheading} locale={locale} onChange={(subheading) => onChange({ ...value, subheading })} />
      <SortableList
        items={value.items}
        onReorder={updateItems}
        renderItem={(item) => (
          <div className="space-y-2 rounded-md border border-slate-800 p-3">
            <div className="flex items-center justify-between">
              <VisibilitySwitch visible={item.visible} onChange={(visible) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, visible } : i)))} />
              <Button variant="ghost" size="sm" onClick={() => updateItems(value.items.filter((i) => i.id !== item.id))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <IconPicker value={item.icon} onChange={(icon) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, icon } : i)))} />
            <LocalizedTextField label="Назва" value={item.title} locale={locale} onChange={(title) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, title } : i)))} />
            <LocalizedTextareaField label="Опис" value={item.description} locale={locale} onChange={(description) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, description } : i)))} />
          </div>
        )}
      />
      <Button variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-2 h-4 w-4" />
        Додати перевагу
      </Button>
    </Section>
  );
}

function PricingEditor({
  value,
  locale,
  onChange,
  plans,
  onPlansChange,
}: {
  value: LandingPageContent['pricing'];
  locale: Locale;
  onChange: (v: LandingPageContent['pricing']) => void;
  plans: PlanRow[];
  onPlansChange: () => void;
}) {
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [savingPlanKey, setSavingPlanKey] = useState<string | null>(null);

  function updateOverride(planKey: string, patch: Partial<LandingPageContent['pricing']['tierCopyOverrides'][number]>) {
    onChange({ ...value, tierCopyOverrides: value.tierCopyOverrides.map((o) => (o.planKey === planKey ? { ...o, ...patch } : o)) });
  }
  function updateFeature(planKey: string, index: number, text: LocalizedText) {
    const override = value.tierCopyOverrides.find((o) => o.planKey === planKey);
    if (!override) return;
    const features = override.features.map((f, i) => (i === index ? text : f));
    updateOverride(planKey, { features });
  }
  async function savePrice(plan: PlanRow) {
    const draft = priceDrafts[plan.key];
    if (draft === undefined) return;
    setSavingPlanKey(plan.key);
    try {
      // Price ALWAYS comes from the real Plan row (billing module) — this
      // writes straight to it via the existing Super Admin Plans endpoint
      // (super-admin/plans, upsert-by-key) so the landing page can never
      // show a price the real, billed plan doesn't back. Re-sends the
      // plan's own name/limits unchanged since that endpoint is a full
      // upsert, not a partial patch.
      await superAdminApi.post('super-admin/plans', { key: plan.key, name: plan.name, monthlyPriceEur: Number(draft), limits: plan.limits });
      await onPlansChange();
      setPriceDrafts((prev) => {
        const next = { ...prev };
        delete next[plan.key];
        return next;
      });
    } finally {
      setSavingPlanKey(null);
    }
  }

  return (
    <Section title="Секція «Тарифи»">
      <div className="flex items-center justify-between rounded-md border border-slate-800 p-3">
        <div>
          <p className="text-sm text-slate-200">Показувати секцію тарифів на сайті</p>
          <p className="text-xs text-slate-500">Вимкни, якщо ціни ще не готові до публікації — секція повністю зникає з публічної сторінки.</p>
        </div>
        <VisibilitySwitch visible={value.visible} onChange={(visible) => onChange({ ...value, visible })} />
      </div>
      <LocalizedTextField label="Заголовок секції" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <LocalizedTextareaField label="Підзаголовок секції" value={value.subheading} locale={locale} onChange={(subheading) => onChange({ ...value, subheading })} />
      <div className="space-y-1.5">
        <Label className="text-slate-300">Ключ виділеного тарифу (напр. growth)</Label>
        <Input
          value={value.highlightedPlanKey ?? ''}
          onChange={(e) => onChange({ ...value, highlightedPlanKey: e.target.value || null })}
          className="border-slate-700 bg-slate-800 text-slate-100"
        />
      </div>
      {value.tierCopyOverrides.map((override) => {
        const plan = plans.find((p) => p.key === override.planKey);
        return (
          <div key={override.planKey} className="space-y-2 rounded-md border border-slate-800 p-3">
            <p className="text-xs font-medium text-slate-500">Тариф: {override.planKey}</p>
            {plan && (
              <div className="space-y-1.5">
                <Label className="text-slate-300">Ціна, €/міс (реальний тариф — впливає на біллінг)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={priceDrafts[plan.key] ?? plan.monthlyPriceEur}
                    onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [plan.key]: e.target.value }))}
                    className="w-32 border-slate-700 bg-slate-800 text-slate-100"
                  />
                  <Button type="button" variant="outline" size="sm" loading={savingPlanKey === plan.key} onClick={() => savePrice(plan)}>
                    Зберегти ціну
                  </Button>
                </div>
              </div>
            )}
            <LocalizedTextField label="Опис" value={override.description} locale={locale} onChange={(description) => updateOverride(override.planKey, { description })} />
            <LocalizedTextField label="Текст кнопки" value={override.ctaLabel} locale={locale} onChange={(ctaLabel) => updateOverride(override.planKey, { ctaLabel })} />
            <div className="space-y-1.5">
              <Label className="text-slate-300">Пункти списку можливостей</Label>
              {override.features.map((f, i) => (
                <LocalizedTextField key={i} label={`Пункт ${i + 1}`} value={f} locale={locale} onChange={(text) => updateFeature(override.planKey, i, text)} />
              ))}
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function FaqEditor({ value, locale, onChange }: { value: LandingPageContent['faq']; locale: Locale; onChange: (v: LandingPageContent['faq']) => void }) {
  function updateItems(items: LandingPageContent['faq']['items']) {
    onChange({ ...value, items: items.map((it, i) => ({ ...it, sortOrder: i })) });
  }
  function addItem() {
    updateItems([...value.items, { id: newId('faq'), question: EMPTY_LOCALIZED, answer: EMPTY_LOCALIZED, sortOrder: value.items.length, visible: true }]);
  }
  return (
    <Section title="Секція «Часті запитання»">
      <LocalizedTextField label="Заголовок секції" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <SortableList
        items={value.items}
        onReorder={updateItems}
        renderItem={(item) => (
          <div className="space-y-2 rounded-md border border-slate-800 p-3">
            <div className="flex items-center justify-between">
              <VisibilitySwitch visible={item.visible} onChange={(visible) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, visible } : i)))} />
              <Button variant="ghost" size="sm" onClick={() => updateItems(value.items.filter((i) => i.id !== item.id))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <LocalizedTextField label="Питання" value={item.question} locale={locale} onChange={(question) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, question } : i)))} />
            <LocalizedTextareaField label="Відповідь" value={item.answer} locale={locale} onChange={(answer) => updateItems(value.items.map((i) => (i.id === item.id ? { ...i, answer } : i)))} />
          </div>
        )}
      />
      <Button variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-2 h-4 w-4" />
        Додати запитання
      </Button>
    </Section>
  );
}

function ContactEditor({ value, locale, onChange }: { value: LandingPageContent['contact']; locale: Locale; onChange: (v: LandingPageContent['contact']) => void }) {
  return (
    <Section title="Секція «Контакти»">
      <LocalizedTextField label="Заголовок" value={value.heading} locale={locale} onChange={(heading) => onChange({ ...value, heading })} />
      <LocalizedTextareaField label="Підзаголовок" value={value.subheading} locale={locale} onChange={(subheading) => onChange({ ...value, subheading })} />
      <div className="space-y-1.5">
        <Label className="text-slate-300">Email для звернень</Label>
        <Input value={value.salesEmail} onChange={(e) => onChange({ ...value, salesEmail: e.target.value })} className="border-slate-700 bg-slate-800 text-slate-100" />
      </div>
      <LocalizedTextField label="Текст про час відповіді" value={value.responseTimeNote} locale={locale} onChange={(responseTimeNote) => onChange({ ...value, responseTimeNote })} />
      <LocalizedTextField label="Текст кнопки відправки форми" value={value.formSubmitLabel} locale={locale} onChange={(formSubmitLabel) => onChange({ ...value, formSubmitLabel })} />
      <LocalizedTextField label="Тема листа (mailto)" value={value.mailtoSubject} locale={locale} onChange={(mailtoSubject) => onChange({ ...value, mailtoSubject })} />
    </Section>
  );
}

function FooterEditor({ value, locale, onChange }: { value: LandingPageContent['footer']; locale: Locale; onChange: (v: LandingPageContent['footer']) => void }) {
  return (
    <Section title="Footer">
      <LocalizedTextareaField label="Текст під логотипом (tagline)" value={value.tagline} locale={locale} onChange={(tagline) => onChange({ ...value, tagline })} />
    </Section>
  );
}

function SeoEditor({ value, locale, onChange }: { value: LandingPageContent['seo']; locale: Locale; onChange: (v: LandingPageContent['seo']) => void }) {
  return (
    <Section title="SEO">
      <LocalizedTextField label="Page Title / OG Title" value={value.title} locale={locale} onChange={(title) => onChange({ ...value, title })} />
      <LocalizedTextareaField label="Meta / OG Description" value={value.description} locale={locale} onChange={(description) => onChange({ ...value, description })} />
      <MediaPicker label="OG Image" value={value.ogImageId} onChange={(ogImageId) => onChange({ ...value, ogImageId })} />
    </Section>
  );
}
