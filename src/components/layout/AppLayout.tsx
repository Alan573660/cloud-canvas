// AppLayout - main authenticated layout wrapper
import { useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export function AppLayout() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const hasRedirected = useRef(false);

  useEffect(() => {
    console.debug('[AppLayout] Guard check - loading:', loading, 'user:', !!user, 'profile:', !!profile, 'path:', location.pathname, 'hasRedirected:', hasRedirected.current);
    
    if (loading || hasRedirected.current) return;

    if (!user) {
      console.debug('[AppLayout] Redirect decision: no user -> /login');
      hasRedirected.current = true;
      navigate('/login', { replace: true });
      return;
    }

    if (!profile) {
      console.debug('[AppLayout] Redirect decision: user exists but no profile -> /onboarding');
      hasRedirected.current = true;
      navigate('/onboarding', { replace: true });
      return;
    }

    console.debug('[AppLayout] Guard passed: user and profile exist');
  }, [user, profile, loading, navigate, location.pathname]);

  // Reset redirect flag when user/profile state changes meaningfully
  useEffect(() => {
    if (user && profile) {
      hasRedirected.current = false;
    }
  }, [user, profile]);

  if (loading) {
    console.debug('[AppLayout] Rendering: loading state');
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !profile) {
    console.debug('[AppLayout] Rendering: waiting for redirect (user:', !!user, 'profile:', !!profile, ')');
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  console.debug('[AppLayout] Rendering: full layout');
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1">
          <AppHeader />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
