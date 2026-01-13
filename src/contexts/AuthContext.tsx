import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    console.log('[AuthContext] fetchProfile called for userId:', userId);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[AuthContext] fetchProfile error:', error);
        return null;
      }

      console.log('[AuthContext] fetchProfile result:', data);
      return data as Profile | null;
    } catch (err) {
      console.error('[AuthContext] fetchProfile exception:', err);
      return null;
    }
  };

  const refreshProfile = async (): Promise<Profile | null> => {
    console.log('[AuthContext] refreshProfile called, user:', user?.id);
    if (user) {
      const profileData = await fetchProfile(user.id);
      console.log('[AuthContext] refreshProfile result:', profileData);
      setProfile(profileData);
      return profileData;
    }
    return null;
  };

  useEffect(() => {
    let isMounted = true;

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] onAuthStateChange event:', event, 'session:', !!session);
      
      if (!isMounted) return;
      
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Defer profile fetch to avoid blocking and deadlock
        setTimeout(async () => {
          if (!isMounted) return;
          console.log('[AuthContext] Deferred fetchProfile for:', session.user.id);
          const profileData = await fetchProfile(session.user.id);
          if (isMounted) {
            setProfile(profileData);
            setLoading(false);
          }
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      
      console.log('[AuthContext] getSession result:', !!session);
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        const profileData = await fetchProfile(session.user.id);
        if (isMounted) {
          setProfile(profileData);
        }
      }

      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    console.log('[AuthContext] signIn called for:', email);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        console.error('[AuthContext] signIn error:', error);
        return { error };
      }
      
      console.log('[AuthContext] signIn success, user:', data.user?.id);
      
      // Immediately fetch profile after successful login
      if (data.user) {
        const profileData = await fetchProfile(data.user.id);
        console.log('[AuthContext] signIn - profile fetched:', profileData);
        setProfile(profileData);
      }
      
      return { error: null };
    } catch (err) {
      console.error('[AuthContext] signIn exception:', err);
      return { error: err as Error };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    console.log('[AuthContext] signUp called for:', email);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: `${window.location.origin}/onboarding`,
        },
      });

      if (error) {
        console.error('[AuthContext] signUp error:', error);
      } else {
        console.log('[AuthContext] signUp success');
      }

      return { error };
    } catch (err) {
      console.error('[AuthContext] signUp exception:', err);
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    console.log('[AuthContext] signOut called');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
