import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const { signIn, user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  // Handle redirect after auth state changes
  useEffect(() => {
    console.debug('[LoginPage] useEffect check - loading:', loading, 'user:', !!user, 'profile:', !!profile);
    
    if (!loading && user) {
      if (profile) {
        console.debug('[LoginPage] Redirect decision: user + profile -> /dashboard');
        navigate('/dashboard', { replace: true });
      } else {
        console.debug('[LoginPage] Redirect decision: user + no profile -> /onboarding');
        navigate('/onboarding', { replace: true });
      }
    }
  }, [user, profile, loading, navigate]);

  const onSubmit = async (data: LoginFormData) => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    console.debug('[LoginPage] Submitting login for:', data.email);
    
    try {
      const { error, profile: fetchedProfile } = await signIn(data.email, data.password);
      
      if (error) {
        console.debug('[LoginPage] Login error:', error.message);
        
        // User-friendly error messages
        if (error.message.includes('Invalid login credentials')) {
          toast.error('Неверный email или пароль');
        } else if (error.message.includes('Email not confirmed')) {
          toast.error('Email не подтверждён. Проверьте почту.');
        } else {
          toast.error(error.message);
        }
        return;
      }

      console.debug('[LoginPage] Login success, profile:', fetchedProfile ? 'found' : 'null');
      toast.success('Вход выполнен');
      
      // Navigate based on profile
      if (fetchedProfile) {
        console.debug('[LoginPage] Direct navigate to /dashboard');
        navigate('/dashboard', { replace: true });
      } else {
        console.debug('[LoginPage] Direct navigate to /onboarding');
        navigate('/onboarding', { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show spinner while loading
  if (loading) {
    console.debug('[LoginPage] Rendering: loading state');
    return (
      <div className="flex h-screen items-center justify-center bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user exists, show spinner (redirect will happen via useEffect)
  if (user) {
    console.debug('[LoginPage] Rendering: user exists, waiting for redirect');
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
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xl">
            S
          </div>
          <CardTitle className="text-2xl">{t('auth.signIn')}</CardTitle>
          <CardDescription>
            SellerRoof — B2B SaaS Platform
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.email')}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="email@example.com"
                        disabled={isSubmitting}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.password')}</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        disabled={isSubmitting}
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('common.loading')}
                  </>
                ) : (
                  t('auth.signIn')
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t('auth.noAccount')}{' '}
                <Link to="/register" className="text-primary hover:underline">
                  {t('auth.signUp')}
                </Link>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
