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

const registerSchema = z.object({
  fullName: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Некорректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  confirmPassword: z.string().min(6, 'Минимум 6 символов'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Пароли не совпадают',
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { t } = useTranslation();
  const { signUp, user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  // Handle redirect after auth state changes
  useEffect(() => {
    console.debug('[RegisterPage] useEffect check - loading:', loading, 'user:', !!user, 'profile:', !!profile);
    
    if (!loading && user) {
      if (profile) {
        console.debug('[RegisterPage] Redirect decision: user + profile -> /dashboard');
        navigate('/dashboard', { replace: true });
      } else {
        console.debug('[RegisterPage] Redirect decision: user + no profile -> /onboarding');
        navigate('/onboarding', { replace: true });
      }
    }
  }, [user, profile, loading, navigate]);

  const onSubmit = async (data: RegisterFormData) => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    console.debug('[RegisterPage] Submitting registration for:', data.email);
    
    try {
      const { error } = await signUp(data.email, data.password, data.fullName);
      
      if (error) {
        console.debug('[RegisterPage] Registration error:', error.message);
        
        // User-friendly error messages
        if (error.message.includes('already registered')) {
          toast.error('Этот email уже зарегистрирован');
        } else if (error.message.includes('valid email')) {
          toast.error('Введите корректный email');
        } else {
          toast.error(error.message);
        }
        return;
      }

      console.debug('[RegisterPage] Registration success');
      toast.success('Регистрация успешна! Проверьте почту для подтверждения.');
      
      // If email confirmation is disabled, user will be logged in automatically
      // and useEffect will handle the redirect
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show spinner while loading
  if (loading) {
    console.debug('[RegisterPage] Rendering: loading state');
    return (
      <div className="flex h-screen items-center justify-center bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If user exists, show spinner (redirect will happen via useEffect)
  if (user) {
    console.debug('[RegisterPage] Rendering: user exists, waiting for redirect');
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
          <CardTitle className="text-2xl">{t('auth.signUp')}</CardTitle>
          <CardDescription>
            {t('auth.register')}
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.fullName')}</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Иван Петров" 
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
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.confirmPassword')}</FormLabel>
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
                  t('auth.signUp')
                )}
              </Button>
              <p className="text-sm text-muted-foreground">
                {t('auth.hasAccount')}{' '}
                <Link to="/login" className="text-primary hover:underline">
                  {t('auth.signIn')}
                </Link>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
