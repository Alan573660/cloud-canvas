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
import { Building2, Loader2 } from 'lucide-react';

const onboardingSchema = z.object({
  organizationName: z.string().min(2, 'Минимум 2 символа').max(100, 'Максимум 100 символов'),
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
    console.log('[OnboardingPage] No user, redirecting to /login');
    navigate('/login', { replace: true });
    return null;
  }

  // If profile already exists, redirect to dashboard
  if (profile) {
    console.log('[OnboardingPage] Profile exists, redirecting to /dashboard');
    navigate('/dashboard', { replace: true });
    return null;
  }

  const onSubmit = async (data: OnboardingFormData) => {
    // Prevent duplicate submissions
    if (isSubmitting) {
      console.log('[OnboardingPage] Submission blocked - already submitting');
      return;
    }
    
    setIsSubmitting(true);
    console.log('[OnboardingPage] Creating organization:', data.organizationName);
    
    try {
      const { data: rpcResult, error } = await supabase.rpc('rpc_onboard_create_org', {
        p_org_name: data.organizationName,
        p_plan: 'base',
      });

      console.log('[OnboardingPage] rpc_onboard_create_org result:', rpcResult, 'error:', error);

      if (error) {
        console.error('[OnboardingPage] RPC error:', error);
        
        // Handle specific error cases
        if (error.message.includes('already')) {
          toast.error('Организация уже создана. Обновляем профиль...');
        } else {
          toast.error(error.message || t('errors.generic'));
        }
        
        // Try to refresh profile anyway - maybe org was created
        const refreshedProfile = await refreshProfile();
        console.log('[OnboardingPage] After error, refreshed profile:', refreshedProfile);
        
        if (refreshedProfile) {
          console.log('[OnboardingPage] Profile found after error, redirecting to /dashboard');
          navigate('/dashboard', { replace: true });
        }
        return;
      }

      toast.success('Организация создана!');
      
      // Wait for profile refresh and ensure it's loaded
      console.log('[OnboardingPage] Refreshing profile after org creation...');
      const refreshedProfile = await refreshProfile();
      console.log('[OnboardingPage] Refreshed profile:', refreshedProfile);
      
      if (refreshedProfile) {
        console.log('[OnboardingPage] Redirect decision: profile exists, going to /dashboard');
        navigate('/dashboard', { replace: true });
      } else {
        // Retry once more after a short delay
        console.log('[OnboardingPage] Profile still null, retrying in 500ms...');
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryProfile = await refreshProfile();
        console.log('[OnboardingPage] Retry profile result:', retryProfile);
        
        if (retryProfile) {
          navigate('/dashboard', { replace: true });
        } else {
          toast.error('Не удалось загрузить профиль. Попробуйте обновить страницу.');
        }
      }
    } catch (err) {
      console.error('[OnboardingPage] Unexpected error:', err);
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
          <CardTitle className="text-2xl">{t('onboarding.createOrganization', 'Создание организации')}</CardTitle>
          <CardDescription>
            {t('onboarding.description', 'Для начала работы создайте вашу организацию')}
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
                    <FormLabel>{t('auth.organizationName', 'Название организации')}</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="ООО Компания" 
                        {...field} 
                        disabled={isSubmitting}
                      />
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
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('common.loading', 'Загрузка...')}
                  </>
                ) : (
                  t('onboarding.createButton', 'Создать организацию')
                )}
              </Button>
            </CardContent>
          </form>
        </Form>
      </Card>
    </div>
  );
}
