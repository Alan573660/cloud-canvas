import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { useAuth } from '@/contexts/AuthContext';

export function AppLayout() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.log('[AppLayout] Guard check - loading:', loading, 'user:', !!user, 'profile:', !!profile, 'path:', location.pathname);
    
    if (!loading) {
      if (!user) {
        console.log('[AppLayout] Redirect decision: no user -> /login');
        navigate('/login', { replace: true });
      } else if (!profile) {
        console.log('[AppLayout] Redirect decision: user exists but no profile -> /onboarding');
        navigate('/onboarding', { replace: true });
      } else {
        console.log('[AppLayout] Guard passed: user and profile exist');
      }
    }
  }, [user, profile, loading, navigate, location.pathname]);

  if (loading) {
    console.log('[AppLayout] Rendering: loading state');
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user || !profile) {
    console.log('[AppLayout] Rendering: waiting for redirect (user:', !!user, 'profile:', !!profile, ')');
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  console.log('[AppLayout] Rendering: full layout');
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
