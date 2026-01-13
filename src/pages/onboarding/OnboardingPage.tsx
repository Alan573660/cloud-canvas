import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';

const onboardingSchema = z.object({
  organizationName: z.string().min(2, 'Минимум 2 символа'),
});

type OnboardingFormData = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
  const { t } = useTranslation();
  const { user, profile, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      organizationName: '',
    },
  });

  // If still loading, show spinner
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // If no user, redirect to login
  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  // If profile already exists, redirect to dashboard
  if (profile) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  const onSubmit = async (data: OnboardingFormData) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('rpc_onboard_create_org', {
        p_org_name: data.organizationName,
        p_plan: 'base',
      });

      if (error) {
        console.error('Error creating organization:', error);
        toast.error(error.message);
        return;
      }

      toast.success(t('common.success'));
      
      // Refresh profile to get the new organization data
      await refreshProfile();
      
      // Navigate to dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('Onboarding error:', err);
      toast.error(t('errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Создание организации</CardTitle>
          <CardDescription>
            Для начала работы создайте вашу организацию
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="organizationName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.organizationName')}</FormLabel>
                    <FormControl>
                      <Input placeholder="ООО Компания" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common.loading') : 'Создать организацию'}
              </Button>
            </CardContent>
          </form>
        </Form>
      </Card>
    </div>
  );
}
