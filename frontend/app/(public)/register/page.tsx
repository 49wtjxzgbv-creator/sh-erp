'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { signupCompany } from '@/lib/api-client/auth';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

// Field constraints mirror backend/src/modules/tenancy/dto/create-company.dto.ts exactly.
const registerSchema = z.object({
  companyName: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]{3,63}$/, 'lowercase letters, numbers, hyphens, 3-63 chars'),
  ownerFullName: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(12),
});
type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterFormValues) {
    setFormError(null);
    try {
      const company = await signupCompany(values);
      router.replace(`/login?next=/dashboard&companySlug=${encodeURIComponent(company.slug)}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('registerTitle')}</CardTitle>
        <CardDescription>{t('registerSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="companyName">{t('companyName')}</Label>
            <Input id="companyName" {...register('companyName')} />
            {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slug">{t('companySlug')}</Label>
            <Input id="slug" placeholder="my-company" {...register('slug')} />
            {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerFullName">Full name</Label>
            <Input id="ownerFullName" autoComplete="name" {...register('ownerFullName')} />
            {errors.ownerFullName && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerEmail">{t('email')}</Label>
            <Input id="ownerEmail" type="email" autoComplete="email" {...register('ownerEmail')} />
            {errors.ownerEmail && <p className="text-xs text-destructive">{errors.ownerEmail.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerPassword">{t('password')}</Label>
            <Input id="ownerPassword" type="password" autoComplete="new-password" {...register('ownerPassword')} />
            {errors.ownerPassword && <p className="text-xs text-destructive">{errors.ownerPassword.message}</p>}
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            {t('registerButton')}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t('haveAccount')}{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            {t('loginButton')}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
