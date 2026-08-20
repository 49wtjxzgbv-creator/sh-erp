'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supplierPortalApi } from '@/lib/supplier-portal/api';
import { useSupplierPortalSessionStore } from '@/lib/supplier-portal/session-store';

export default function SupplierPortalLoginPage() {
  const t = useTranslations('supplierPortal');
  const ta = useTranslations('auth');
  const router = useRouter();
  const setSession = useSupplierPortalSessionStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await supplierPortalApi.post<{ accessToken: string; expiresIn: string }>('supplier-portal/auth/login', {
        email,
        password,
      });
      setSession({ accessToken: res.accessToken, email });
      router.replace('/supplier-portal');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Tabs value="/supplier-portal/login" className="mb-4">
          <TabsList className="w-full justify-center">
            <TabsTrigger value="/login" asChild>
              <Link href="/login">{ta('tabCompany')}</Link>
            </TabsTrigger>
            <TabsTrigger value="/supplier-portal/login" asChild>
              <Link href="/supplier-portal/login">{ta('tabSupplier')}</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Card>
          <CardHeader>
            <CardTitle>{t('loginTitle')}</CardTitle>
            <CardDescription>{t('loginDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')}</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>
                {t('signIn')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
