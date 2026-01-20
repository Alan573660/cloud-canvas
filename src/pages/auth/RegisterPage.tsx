import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
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
  FormDescription,
} from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Loader2, Check, X, AlertTriangle } from 'lucide-react';

// Common leaked/weak passwords to block (sample list)
const WEAK_PASSWORDS = new Set([
  'password', 'password123', '123456', '12345678', '123456789',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'admin', 'admin123',
  'login', 'abc123', 'monkey', 'master', 'dragon', 'passw0rd',
  '1234567890', 'password1', 'iloveyou', 'trustno1', 'sunshine',
  'princess', 'football', 'baseball', 'welcome1', 'shadow', 'superman',
  'michael', 'ninja', '12345', '1234567', '654321', 'password!',
]);

// Password strength calculation
function calculatePasswordStrength(password: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 0;

  if (password.length >= 8) score += 20;
  else issues.push('Минимум 8 символов');

  if (password.length >= 12) score += 10;

  if (/[a-z]/.test(password)) score += 15;
  else issues.push('Добавьте строчные буквы');

  if (/[A-Z]/.test(password)) score += 15;
  else issues.push('Добавьте заглавные буквы');

  if (/[0-9]/.test(password)) score += 20;
  else issues.push('Добавьте цифры');

  if (/[^a-zA-Z0-9]/.test(password)) score += 20;
  else issues.push('Добавьте спецсимволы (!@#$%...)');

  // Penalty for weak passwords
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    score = 0;
    issues.unshift('Этот пароль слишком распространён');
  }

  return { score: Math.min(score, 100), issues };
}

const registerSchema = z.object({
  fullName: z.string().min(2, 'Минимум 2 символа').max(100, 'Максимум 100 символов'),
  email: z.string().email('Некорректный email').max(255, 'Максимум 255 символов'),
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(128, 'Максимум 128 символов')
    .refine(
      (val) => !WEAK_PASSWORDS.has(val.toLowerCase()),
      'Этот пароль слишком распространён и небезопасен'
    )
    .refine(
      (val) => /[A-Z]/.test(val) && /[a-z]/.test(val) && /[0-9]/.test(val),
      'Пароль должен содержать заглавные, строчные буквы и цифры'
    ),
  confirmPassword: z.string().min(8, 'Минимум 8 символов'),
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
    mode: 'onChange', // Validate on change for real-time feedback
  });

  // Watch password for strength indicator
  const watchedPassword = useWatch({ control: form.control, name: 'password' });
  
  const passwordStrength = useMemo(() => {
    if (!watchedPassword) return { score: 0, issues: [] };
    return calculatePasswordStrength(watchedPassword);
  }, [watchedPassword]);

  const getStrengthColor = (score: number) => {
    if (score < 30) return 'bg-destructive';
    if (score < 60) return 'bg-yellow-500';
    if (score < 80) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getStrengthLabel = (score: number) => {
    if (score < 30) return 'Слабый';
    if (score < 60) return 'Средний';
    if (score < 80) return 'Хороший';
    return 'Отличный';
  };

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
                    {/* Password strength indicator */}
                    {watchedPassword && watchedPassword.length > 0 && (
                      <div className="space-y-2 mt-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Сложность пароля</span>
                          <span className={`font-medium ${
                            passwordStrength.score < 30 ? 'text-destructive' :
                            passwordStrength.score < 60 ? 'text-yellow-600' :
                            passwordStrength.score < 80 ? 'text-blue-600' : 'text-green-600'
                          }`}>
                            {getStrengthLabel(passwordStrength.score)}
                          </span>
                        </div>
                        <Progress 
                          value={passwordStrength.score} 
                          className="h-1.5"
                        />
                        {passwordStrength.issues.length > 0 && (
                          <ul className="text-xs space-y-1 mt-1">
                            {passwordStrength.issues.slice(0, 3).map((issue, i) => (
                              <li key={i} className="flex items-center gap-1 text-muted-foreground">
                                {WEAK_PASSWORDS.has(watchedPassword.toLowerCase()) ? (
                                  <AlertTriangle className="h-3 w-3 text-destructive" />
                                ) : (
                                  <X className="h-3 w-3 text-muted-foreground" />
                                )}
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}
                        {passwordStrength.score >= 80 && (
                          <div className="flex items-center gap-1 text-xs text-green-600">
                            <Check className="h-3 w-3" />
                            Надёжный пароль
                          </div>
                        )}
                      </div>
                    )}
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
