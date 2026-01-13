import { useState, useEffect, useRef } from 'react';
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
  const hasRedirected = useRef(false);

  const form = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      organizationName: '',
    },
  });

  // Handle redirects via useEffect to avoid render-time navigation
  useEffect(() => {
    console.debug('[OnboardingPage] useEffect check - loading:', loading, 'user:', !!user, 'profile:', !!profile, 'hasRedirected:', hasRedirected.current);
    
    if (loading || hasRedirected.current) return;

    if (!user) {
      console.debug('[OnboardingPage] Redirect decision: no user -> /login');
      hasRedirected.current = true;
      navigate('/login', { replace: true });
      return;
    }

    if (profile) {
      console.debug('[OnboardingPage] Redirect decision: user + profile -> /dashboard');
      hasRedirected.current = true;
      navigate('/dashboard', { replace: true });
      return;
    }

    console.debug('[OnboardingPage] Staying on onboarding: user exists, no profile');
  }, [user, profile, loading, navigate]);

  const onSubmit = async (data: OnboardingFormData) => {
    // Strict double-click prevention
    if (isSubmitting) {
      console.debug('[OnboardingPage] Submission blocked - already submitting');
      return;
    }
    
    setIsSubmitting(true);
    console.debug('[OnboardingPage] Creating organization:', data.organizationName);
    
    try {
      const { data: orgId, error } = await supabase.rpc('rpc_onboard_create_org', {
        p_org_name: data.organizationName.trim(),
        p_plan: 'base',
      });

      console.debug('[OnboardingPage] rpc_onboard_create_org result - orgId:', orgId, 'error:', error?.message);

      if (error) {
        console.debug('[OnboardingPage] RPC error:', error.message);
        
        // Check if org was actually created (duplicate request)
        const refreshedProfile = await refreshProfile();
        if (refreshedProfile) {
          console.debug('[OnboardingPage] Profile found after error, redirecting to /dashboard');
          toast.success('Организация уже создана');
          hasRedirected.current = true;
          navigate('/dashboard', { replace: true });
          return;
        }
        
        toast.error(error.message || 'Ошибка создания организации');
        return;
      }

      toast.success('Организация создана!');
      console.debug('[OnboardingPage] Organization created, orgId:', orgId);
      
      // Poll for profile until it exists (max 5 attempts)
      let profileData = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        console.debug('[OnboardingPage] Refreshing profile, attempt:', attempt);
        profileData = await refreshProfile();
        
        if (profileData) {
          console.debug('[OnboardingPage] Profile found on attempt:', attempt);
          break;
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      }
      
      if (profileData) {
        console.debug('[OnboardingPage] Success - navigating to /dashboard');
        hasRedirected.current = true;
        navigate('/dashboard', { replace: true });
      } else {
        console.debug('[OnboardingPage] Failed to fetch profile after 5 attempts');
        toast.error('Профиль не загружен. Попробуйте обновить страницу.');
      }
    } catch (err) {
      console.debug('[OnboardingPage] Unexpected error:', err);
      toast.error('Неожиданная ошибка');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show spinner while loading
  if (loading) {
    console.debug('[OnboardingPage] Rendering: loading state');
    return (
      <div className="flex h-screen items-center justify-center bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If no user or profile exists, show spinner (redirect will happen via useEffect)
  if (!user || profile) {
    console.debug('[OnboardingPage] Rendering: waiting for redirect');
    return (
      <div className="flex h-screen items-center justify-center bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
                        disabled={isSubmitting}
                        {...field} 
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
                    {t('common.loading', 'Создание...')}
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
